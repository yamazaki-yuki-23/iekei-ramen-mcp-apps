/**
 * ローカル実行用エントリポイント（Node.js）。
 *  npx tsx main.ts          → http://localhost:3031/mcp（PORT で変更可）
 *  npx tsx main.ts --stdio  → stdio トランスポート
 * Cloudflare にデプロイするときは worker.ts が使われる。
 */
import { createServer as createHttpServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.ts";
import worker, { serveMcp } from "./worker.ts";
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

/** 手元用の空の環境。バインディングは wrangler でしか手に入らない。 */
const localEnv = () =>
  ({
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "",
    VISITOR_ID_PEPPER: process.env.VISITOR_ID_PEPPER ?? "",
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
        ? await serveMcp(request, { visitor: { id: devVisitor }, visits: devVisits })
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
  await createServer().connect(new StdioServerTransport());
} else {
  await startHttp();
}
