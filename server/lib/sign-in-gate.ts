/**
 * KV へ書くサインインの入口を、**接続元ごとに 1 日で数える**（#427）。
 *
 * KV の書き込みの枠はアカウントで 1 つ（無料プランは 1 日 1,000 件）。尽きると、その日は全員の
 * サインインが止まる。Rate Limiting binding は 60 秒より長い窓を持てないので、1 分に 1 回でも
 * 1 日で 1,440 回通り、1 つの接続元で枠を使い切れる。1 日の数はここで持つ。
 *
 * 上限の決め方（1 つの接続元が両方を使い切ったときの KV の書き込み）:
 * - `authorize`（GET /authorize）: 利用者のブラウザから来る。開いて最後まで進むと、書き込みは最大 5 件
 *   （許可画面の控え・Google 用の控え・認可・トークン・認可の更新。@cloudflare/workers-oauth-provider 1.2.4 を
 *   読んで数えた）。許可から先は、開いた許可画面の控えが無いと進めないので、開いた回数より増えない
 * - `register`（POST /register。登録 1 回で 1 件）: Claude・ChatGPT は自社のサーバーから登録し、
 *   多くの利用者が同じ接続元になるので、許可画面より多くしてある
 * 合わせて 1 日 300 + 50 × 5 = 550 件で、1,000 件に収まる（地名のキャッシュはもう KV に書かない）。
 * 消去（控えを使い終えたとき。1 回で最大 2 件）は別の枠（同じく 1 日 1,000 件）で、50 × 2 = 100 件。
 *
 * ponytail: 接続元ごとの数なので、多くの接続元から同時に来れば枠は尽きうる。そのときは全体の上限を足す。
 */

export const DAILY_LIMITS = { authorize: 50, register: 300 } as const;
export type SignInEntry = keyof typeof DAILY_LIMITS;

type Count = { day: string; count: number };
type GateStorage = Pick<DurableObjectStorage, "get" | "put">;

/**
 * 今日の分を 1 つ数えた後の値。上限に届いていたら null（数えない）。
 * 日が変わったら 0 から数え直す（日付は UTC。KV の 1 日の枠も UTC の 0 時で戻る）。
 */
export function countUp(previous: Count | undefined, day: string, limit: number): Count | null {
  const count = previous?.day === day ? previous.count : 0;
  return count >= limit ? null : { day, count: count + 1 };
}

const isEntry = (value: string): value is SignInEntry => Object.hasOwn(DAILY_LIMITS, value);

/**
 * 接続元 1 つに 1 つの Durable Object。数えるたびに保存を 1 件書くが、上限に届いた後は書かない
 * （断るときに書くと、こちらの保存の枠を連打で使わせることになる）。
 *
 * **RPC ではなく fetch で受ける**（GeocodeGate と同じ理由。`cloudflare:workers` を取り込むと、
 * Node で動くテストと手元のサーバーが worker.ts を読み込めなくなる）。
 */
export class SignInGate {
  readonly #storage: GateStorage;

  constructor(state: { storage: GateStorage }) {
    this.#storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const entry = new URL(request.url).pathname.slice(1);
    if (!isEntry(entry)) return new Response(null, { status: 400 });
    const day = new Date().toISOString().slice(0, 10);
    const next = countUp(await this.#storage.get<Count>(entry), day, DAILY_LIMITS[entry]);
    if (!next) return new Response(null, { status: 429 });
    await this.#storage.put(entry, next);
    return new Response(null, { status: 204 });
  }
}

/**
 * その接続元の今日の分を数え、まだ上限に届いていなければ true。
 * **数えられないとき（binding が無い・失敗）は通す**（止めるとサインインの入口が塞がる。/register と同じ）。
 */
export async function allowSignIn(
  gate: DurableObjectNamespace | undefined,
  ip: string,
  entry: SignInEntry,
): Promise<boolean> {
  if (!gate) return true;
  try {
    const response = await gate.get(gate.idFromName(ip)).fetch(`https://sign-in-gate/${entry}`);
    return response.status !== 429;
  } catch {
    return true;
  }
}
