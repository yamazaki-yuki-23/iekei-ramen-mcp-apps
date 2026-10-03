/**
 * ローカル実行用エントリポイント（Node.js）。
 *  npx tsx main.ts          → http://localhost:3031/mcp（PORT で変更可）
 *  npx tsx main.ts --stdio  → stdio トランスポート
 * Cloudflare にデプロイするときは worker.ts が使われる。
 */
import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.ts";
import worker, { serveMcp } from "./worker.ts";
import { GeocodeGate } from "./src/lib/geocode-gate.ts";
import { memoryVisits } from "./src/lib/visits.ts";

const PORT = Number(process.env.PORT ?? 3031);

/**
 * 手元だけの「サインイン済み」。
 *
 * `IEKEI_DEV_VISITOR=誰か` を付けて起動すると、その人としてすべての
 * リクエストを処理する。会員機能の画面（行った店・制覇率）を、Google の
 * サインインを通さずに動かして確かめるため。
 *
 * **この道は main.ts にしか無い。** worker.ts（本番に出る側）に入れると、
 * 環境変数ひとつで認証を迂回できる口を本番へ置くことになる。
 * 記録は process の中だけに持つので、落とせば消える。
 */
const devVisitor = process.env.IEKEI_DEV_VISITOR;
const devVisits = devVisitor ? memoryVisits() : undefined;

/**
 * 手元にも、Nominatim への列（本番の GEOCODE_GATE と同じもの）を置く。
 *
 * **無いと、手元のサーバーは規約を守れない。** 本番は Durable Object が全体を
 * 1 秒 1 回に並べるが、手元にはその束縛が無く、問い合わせはそのまま外へ出る。
 * E2E を並列に流すと、同じ 3131 に複数の worker から地名検索が来るので
 * 規約違反になる（実測: 2 本が 70ms 間隔で出ていた）。
 *
 * 列はプロセスに 1 つ。同じ地名がまとまるのも本番と同じで、E2E の地名検索は
 * どれも「横浜駅」なので、重なっても外へは 1 本しか出ない。
 */
const gateStore = new Map<string, unknown>();
const localGate = new GeocodeGate({
  storage: {
    get: async (key: string) => gateStore.get(key),
    put: async (key: string, value: unknown) => void gateStore.set(key, value),
  } as never,
});
/**
 * E2E では Nominatim へ出ていかない。決まった応答を返す（`IEKEI_GEOCODE_FIXTURE`）。
 *
 * **手元の列だけでは、外への問い合わせを並べきれない。** 列はプロセスに 1 つで、
 * CI は E2E を 2 つのジョブ（別々のマシン）に分けて同時に流す。PR が重なれば
 * ワークフローごと同時に走る。どれも同じ公開サーバーへ問い合わせるので、全体で
 * 1 秒 1 回は守れない。テストが確かめたいのは地名を解決した後の振る舞いなので、
 * 外へ出る応答だけを差し替え、サーバーの解決の処理はそのまま通す。
 *
 * 地名ごとに持つ。知らない地名は 0 件で返す（何でも横浜にすると、別の地名を
 * 足したテストが黙って横浜を相手に通る）。
 */
const geocodeFixture = process.env.IEKEI_GEOCODE_FIXTURE
  ? (JSON.parse(readFileSync(process.env.IEKEI_GEOCODE_FIXTURE, "utf8")) as Record<
      string,
      unknown[]
    >)
  : undefined;

const localNominatim = (target: string, init: RequestInit) => {
  if (geocodeFixture) {
    const q = new URL(target).searchParams.get("q") ?? "";
    return Promise.resolve(Response.json(geocodeFixture[q] ?? []));
  }
  return localGate.fetch(new Request(target, init));
};

/** 手元用の環境。KV も D1 も無いが、Nominatim への列だけは手元にも置く。 */
const localEnv = () =>
  ({
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "",
    VISITOR_ID_PEPPER: process.env.VISITOR_ID_PEPPER ?? "",
    // worker.ts は `gate.get(gate.idFromName(...)).fetch(...)` で呼ぶ。その形だけ真似る。
    GEOCODE_GATE: { idFromName: () => "nominatim", get: () => ({ fetch: localNominatim }) },
  }) as never;

const localCtx = () => ({ waitUntil: () => {}, passThroughOnException: () => {} }) as never;

/** Node の IncomingMessage を Web 標準の Request に変換して worker に委譲する。 */
async function startHttp() {
  const http = createHttpServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

    const request = new Request(`http://localhost:${PORT}${req.url ?? "/"}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body,
      // @ts-expect-error Node の fetch 実装が要求する
      duplex: "half",
    });

    /*
     * ローカルには KV も D1 も無い。**匿名の経路はこれで通る**——署名の検証も
     * 記録の読み書きも、トークンがあるときにしか走らないため。会員機能まで
     * 手元で試すときは `npm run dev:worker`（wrangler）を使う。
     */
    /*
     * **CORS のプリフライト（OPTIONS）は横取りしない。** serveMcp は MCP の
     * 応答しか作らないので、ここで受けるとヘッダの無い返事になり、ブラウザは
     * この道を塞ぐ（実測: basic-host のサーバー一覧が Loading… のまま止まった）。
     */
    const response =
      devVisitor && request.method !== "OPTIONS" && new URL(request.url).pathname === "/mcp"
        ? await serveMcp(request, {
            visitor: { id: devVisitor },
            visits: devVisits,
            nominatim: localNominatim,
          })
        : await worker.fetch(request, localEnv(), localCtx());
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        res.write(chunk);
      }
    }
    res.end();
  });

  http.listen(PORT, () => {
    console.error(`MCP server listening on http://localhost:${PORT}/mcp`);
  });
}

if (process.argv.includes("--stdio")) {
  /*
   * Claude Desktop はこの道で起動する。HTTP と同じく、偽のサインインと
   * Nominatim の列を渡す（無いと会員の画面を出せず、地名検索は列を通らない）。
   */
  await createServer({
    visitor: devVisitor ? { id: devVisitor } : null,
    visits: devVisits,
    nominatim: localNominatim,
  }).connect(new StdioServerTransport());
} else {
  await startHttp();
}
