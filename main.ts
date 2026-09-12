/**
 * ローカル実行用エントリポイント（Node.js）。
 *  node --experimental-strip-types main.ts          → http://localhost:3001/mcp
 *  node --experimental-strip-types main.ts --stdio  → stdio トランスポート
 * Cloudflare にデプロイするときは worker.ts が使われる。
 */
import { createServer as createHttpServer } from "node:http";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";
import worker from "./worker.js";

const PORT = Number(process.env.PORT ?? 3031);

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

    const response = await worker.fetch(request);
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
