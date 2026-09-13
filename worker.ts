/**
 * Cloudflare Workers のエントリポイント。
 * MCP の Streamable HTTP を /mcp で受ける（ステートレス構成）。
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createServer } from "./server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/health") {
      return new Response("ok", { headers: CORS_HEADERS });
    }

    // 接続元のおおよその位置を返す。
    // stdio で動くローカルサーバーには HTTP リクエストが無く、Cloudflare が付ける
    // 位置情報を読めないため、ここへ問い合わせて代わりに取得する。
    if (url.pathname === "/whereami") {
      const cf = (request as { cf?: Record<string, unknown> }).cf;
      return new Response(
        JSON.stringify({
          latitude: cf?.latitude ?? null,
          longitude: cf?.longitude ?? null,
          city: cf?.city ?? null,
          region: cf?.region ?? null,
        }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not Found. MCP endpoint is /mcp", {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    // ステートレスなので、リクエストごとにサーバーとトランスポートを作る。
    const server = createServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      console.error("MCP error:", error);
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
  },
};
