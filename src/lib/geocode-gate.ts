/**
 * Nominatim への問い合わせを、**全体で 1 本の列に並べる**。
 *
 * ポリシーは「1 秒 1 回まで」で、これは利用者ごとではなく**こちら全体**の上限。
 * Rate Limiting binding は拠点ごと・接続元ごとに数えるので、別々の人が同じ
 * 1 秒に投げると両方通る。全体で 1 つだけ存在する Durable Object に順番を
 * 取らせれば、どの拠点から来ても同じ列に並ぶ。
 */

import { GeocodeTimeoutError, withGeocodeTimeout } from "./geocode-timeout";

/** 間隔。1 秒ちょうどにすると、時計のずれで 1 秒に 2 回と数えられうる。 */
export const GEOCODE_SPACING_MS = 1100;

/** これ以上待たせるなら断る。列が伸びた状態で待たせ続けると、画面が固まって見える。 */
export const GEOCODE_MAX_WAIT_MS = 3000;

/**
 * 次に空いている枠を取る。**待つ時間（ms）を返し、断るなら null。**
 * 取った枠は予約済みにするので、同時に来た 2 本は 0 ms と 1100 ms に並ぶ。
 */
export function reserveSlot(nextFree: number, now: number): { wait: number; next: number } | null {
  const at = Math.max(now, nextFree);
  if (at - now > GEOCODE_MAX_WAIT_MS) return null;
  return { wait: at - now, next: at + GEOCODE_SPACING_MS };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Durable Object の保存領域のうち、ここで使う分だけ。テストでは Map で代わりをする。 */
type GateStorage = Pick<DurableObjectStorage, "get" | "put">;

/**
 * 同じ問い合わせをまとめる時間。**KV に書いた結果が他の拠点から読めるまで**
 * （最大 60 秒ほどかかる）の間、同じ地名を Nominatim へ流し直さない。
 * 数え始めは答えが返ったとき。そのあと Worker が KV に書くまでの分を 10 秒足す。
 */
const RECENT_MS = 70_000;

type Answer = { status: number; body: string } | null;

/**
 * 列を持ち、**Nominatim への送信もここで行う** Durable Object。
 *
 * 待ち時間だけ返して呼び出し元に送らせると、拠点ごとの遅れの差で間隔が
 * 1 秒を割り、順番が入れ替わることすらある。送るのがここ 1 か所なら、
 * 同じ時計と同じタイマーで並ぶ。
 *
 * **RPC ではなく fetch で受ける**——RPC にするには `cloudflare:workers` を
 * 取り込む必要があり、Node で動くテストと手元のサーバーが worker.ts を
 * 読み込めなくなる。受け取った Request（Nominatim の URL と User-Agent）を
 * そのまま送り出す。
 */
export class GeocodeGate {
  readonly #storage: GateStorage;
  /** 保存領域から読んだ次の枠。**読むのは作り直した直後の 1 回だけ**（同時に来ても同じ読み込みを待つ）。 */
  #loaded: Promise<number | undefined> | undefined;
  /** 次の枠。読んだ後はここを正とする。 */
  #nextFree: number | undefined;
  /** 最後に実際に送った時刻。予約した枠ではなく、こちらで間隔を測る。 */
  #lastSentAt = 0;
  /** 送った（送る予定の）問い合わせ。同時に来た同じ地名は、ここで 1 本にまとめる。 */
  readonly #recent = new Map<string, { doneAt?: number; answer: Promise<Answer> }>();

  constructor(state: { storage: GateStorage }) {
    this.#storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const now = Date.now();
    // 送っている最中のものは捨てない。数えるのは答えが返ってから。
    for (const [url, entry] of this.#recent) {
      if (entry.doneAt !== undefined && now - entry.doneAt > RECENT_MS) this.#recent.delete(url);
    }
    let entry = this.#recent.get(request.url);
    if (!entry) {
      const mine: { doneAt?: number; answer: Promise<Answer> } = {
        answer: this.#dispatch(request, now),
      };
      entry = mine;
      this.#recent.set(request.url, mine);
      // 失敗はまとめない。次の人は問い合わせ直してよい。
      const forget = () => {
        if (this.#recent.get(request.url) === mine) this.#recent.delete(request.url);
      };
      /*
       * **投げられたときも片付ける。** 送信の失敗は答えに直してあるが、保存領域への
       * 書き込みなど、ほかの経路で投げることもある。片付けないと、期限の付かない
       * 失敗が控えに残り、同じ地名はずっとそれを返す。
       */
      void mine.answer.then((a) => {
        if (a?.status === 200) mine.doneAt = Date.now();
        else forget();
      }, forget);
    }
    const answer = await entry.answer;
    // 待たせすぎになるので断った。Nominatim 自身が混んでいるときと同じ 429 にする。
    if (!answer) return new Response(null, { status: 429 });
    return new Response(answer.body, {
      status: answer.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * 枠を取り、その時刻まで待ってから送る。
   *
   * **次の枠は保存領域にも書く。** メモリにだけ持つと、追い出されて作り直された
   * 直後は 0 に戻り、予約済みの枠と同じ 1 秒にもう 1 本通してしまう。
   *
   * **枠を取るところは await を挟まずに済ませる。** 読んでから書くまでの間に
   * 別の問い合わせが同じ値を読むと、同じ枠を 2 本が取る。保存領域の読み書きの
   * 間に割り込まれない保証に頼らず、メモリの値を同期的に進める。
   */
  async #dispatch(request: Request, now: number): Promise<Answer> {
    this.#loaded ??= this.#storage.get<number>("nextFree").then((stored) =>
      // 保存完了は送信より前なので、保存値だけでは最後の実送信時刻が分からない。
      // 作り直した実体は読み終えた時刻から1間隔待つ。先の予約があれば維持する。
      stored === undefined ? undefined : Math.max(stored, Date.now() + GEOCODE_SPACING_MS),
    );
    const stored = await this.#loaded;
    const slot = reserveSlot(this.#nextFree ?? stored ?? 0, now);
    if (!slot) return null;
    this.#nextFree = slot.next;
    await this.#storage.put("nextFree", slot.next);
    return this.#sendWhenGapOpens(request, slot.next - GEOCODE_SPACING_MS);
  }

  /** 保存・タイマーの遅れを含め、判定とfetch開始の間にはawaitを挟まない。 */
  async #sendWhenGapOpens(request: Request, notBefore: number): Promise<Answer> {
    /*
     * **送る直前に、前の 1 本を実際に送った時刻から測り直す。** 処理が詰まって
     * 起きる予定の時刻を過ぎると、待っていた何本ものタイマーが続けて起き、
     * 予約どおりの間隔が潰れて同じ 1 秒に送る（実測: 2.5 秒詰まらせると
     * 2 本目と 3 本目の間が 1 ms）。起きた後は同期的に確かめて時刻を書くので、
     * 続けて起きた方は必ず待ち直す。
     */
    const gap = this.#remainingGap(notBefore);
    if (gap > 0) {
      await sleep(gap);
      return this.#sendWhenGapOpens(request, notBefore);
    }
    /*
     * 待機の後に保存する。置き換えられた古い実体はここで失敗し、送信を続けない。
     * 保存値は実送信時刻ではない。await中に別の1本が送られた場合も待ち直し、
     * 次に起きた後にもう一度保存する。判定後のfetch開始まではawaitを挟まない。
     */
    this.#nextFree = Math.max(this.#nextFree ?? 0, Date.now() + GEOCODE_SPACING_MS);
    await this.#storage.put("nextFree", this.#nextFree);
    const remaining = this.#remainingGap(notBefore);
    if (remaining > 0) {
      await sleep(remaining);
      return this.#sendWhenGapOpens(request, notBefore);
    }
    /*
     * **送信そのものの失敗も答えにする。投げたままにしない。** 落ちた Promise を
     * 控えに残すと、60 秒の間、同じ地名はずっと同じ失敗を返す（後片付けは
     * 成功した答えにしか走らない）。
     */
    // 本文の読み込みも囲む。応答の頭が届いたあとに切れることもある。
    try {
      return await withGeocodeTimeout(async (signal) => {
        // 同じ地名の利用者で共有する通信は、Gate 自身の期限でキャンセルする。
        const outgoing = new Request(request, { signal });
        let upstream: Promise<Response>;
        try {
          upstream = fetch(outgoing);
        } finally {
          // 呼び出し後の時刻は実際の開始時刻より早くならない。同期throwでも間隔を置く。
          this.#lastSentAt = Date.now();
          this.#nextFree = Math.max(this.#nextFree ?? 0, this.#lastSentAt + GEOCODE_SPACING_MS);
        }
        const res = await upstream;
        // 失敗のときは状態だけ返す。受け取る側は、失敗の本文を読まない。
        return { status: res.status, body: res.ok ? await res.text() : "" };
      });
    } catch (error) {
      return { status: error instanceof GeocodeTimeoutError ? 504 : 502, body: "" };
    }
  }

  #remainingGap(notBefore: number) {
    return Math.max(notBefore, this.#lastSentAt + GEOCODE_SPACING_MS) - Date.now();
  }
}
