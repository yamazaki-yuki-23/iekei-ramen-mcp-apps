/**
 * Cloudflare Workers のエントリポイント。
 * MCP の Streamable HTTP を /mcp で受ける（ステートレス構成）。
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import {
  handleOAuth,
  signInChallenge,
  finishSignIn,
  isOAuthPath,
  isResourceMetadataPath,
  resourceMetadata,
  startSignIn,
  visitorOf,
  type AuthEnv,
} from "./oauth.ts";
import { createServer, MEMBER_TOOLS, type ServerDeps } from "./server.ts";
import { GeocodeGate } from "./src/lib/geocode-gate.ts";
import { recordUsage, usageEvent } from "./src/lib/usage.ts";
import { d1Visits } from "./src/lib/visits.ts";
import { handleReport } from "./src/lib/report-endpoint.ts";

// wrangler が Durable Object のクラスを探すのは、入口のモジュールの export。
export { GeocodeGate };

interface Env extends AuthEnv {
  VISITS: D1Database;
  /** 地名検索（Nominatim）の連打止め。接続元ごとに数える。 */
  GEOCODE_LIMITER?: RateLimit;
  REPORT_LIMITER?: RateLimit;
  /** Nominatim へ出ていく問い合わせの列。全体で 1 つ。 */
  GEOCODE_GATE?: DurableObjectNamespace;
  /** 使われているかを数える（Workers Analytics Engine）。手元の Node サーバーには無い。 */
  USAGE?: AnalyticsEngineDataset;
}

/** 認可サーバーが受け持つ道か（`/authorize` と Google からの戻りを含む）。 */
function isSignInPath(pathname: string): boolean {
  return isOAuthPath(pathname) || pathname === "/authorize" || pathname === "/callback/google";
}

/**
 * サインインが要る tool を呼ぼうとしているか。
 *
 * **まとめて送られた（配列の）本文も 1 件ずつ見る。** 1 件の形だけ見ていると、
 * 記録の tool を配列に包むだけで 401 をすり抜ける（実測: 直す前は 200）。
 * 1 件でも混ざっていれば全体を止める。
 */
function needsSignIn(body: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  return messages.some((message) => {
    const m = message as { method?: unknown; params?: { name?: unknown } } | null;
    return (
      m?.method === "tools/call" && (MEMBER_TOOLS as readonly unknown[]).includes(m.params?.name)
    );
  });
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
  /*
   * **WWW-Authenticate も読めるようにする。** 別の origin で動くブラウザの
   * クライアントは、既定では応答のヘッダをほとんど読めない。隠れると、401 が
   * 届いてもサインインの入口が分からないままになる。
   */
  "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = url.origin;

    if (url.pathname === "/reports") return handleReport(request, env);

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

    /*
     * 401 が指す先（資源メタデータ）。**ライブラリを通さない**——認可サーバー側の
     * 文書とは持ち主が違い、こちらは KV が無くても返せる。
     */
    if (isResourceMetadataPath(url.pathname)) return resourceMetadata(origin, CORS_HEADERS);

    /*
     * 認可サーバーに任せる道。**`/authorize` は含めない**——そこは Google へ
     * 送り出す入口で、こちらが持つ。
     *
     * **KV が無い環境では触らせない。** 認可サーバーは `cloudflare:workers` を
     * 取り込むので、Node で動かしている手元の開発サーバーでは読み込み自体が
     * 失敗し、**プロセスごと落ちる**（ESM ローダの失敗は try/catch で拾えない）。
     * 手元で会員機能を試すときは wrangler（`npm run dev:worker`）を使う。
     */
    if (isSignInPath(url.pathname)) {
      if (!env.OAUTH_KV) {
        return new Response("この環境ではサインインを使えません（wrangler で起動してください）", {
          status: 501,
          headers: CORS_HEADERS,
        });
      }
      if (isOAuthPath(url.pathname)) return handleOAuth(request, env, ctx, origin);
      if (url.pathname === "/authorize") return startSignIn(request, env, origin);
      return finishSignIn(request, env, origin);
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not Found. MCP endpoint is /mcp", {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    /*
     * 誰のリクエストか。**無ければ匿名**で、そのまま通す。
     * ここで止めると、検索しに来ただけの人にサインインを強いることになる。
     */
    const visitor = await visitorOf(request, env, origin);

    /*
     * **本文を先に読んで、401 にするか決める。** tool の中からは HTTP の状態を
     * 決められないので、サインインが要る tool はここで止める。ChatGPT はこの
     * 401 を見て「アクセス権を更新」を出す（疎通試験で実測済み）。
     *
     * **読むのは複製から。POST だけ。** 元の Request をそのまま先へ渡すため。
     * 作り直すと Cloudflare が付ける `request.cf` が落ち、位置を渡さないホスト
     * から呼ばれた `find-nearby-iekei-ramen` が現在地を見失う（実測: /whereami が
     * Saitama を返す状況で origin が null になった）。GET / DELETE は本文が
     * 空なので読まない。
     */
    const raw = request.method === "POST" ? await request.clone().text() : null;
    // 401 にも CORS を付ける。付けないとブラウザが応答ごと捨て、クライアントには
    // 「通信に失敗した」としか見えない（サインインが始まらない）。
    if (!visitor && raw !== null && needsSignIn(raw)) return signInChallenge(origin, CORS_HEADERS);

    const { GEOCODE_LIMITER: limiter, GEOCODE_GATE: gate } = env;
    return serveMcp(request, {
      visitor,
      visits: env.VISITS ? d1Visits(env.VISITS) : undefined,
      /*
       * **OAuth と同じ KV に相乗りする。** 地名は `geocode:` で始まる鍵に置くので
       * 認可の控えとは混ざらない。消えても問い合わせ直すだけで済む。
       */
      geocodeCache: env.OAUTH_KV,
      // 接続元ごとの連打止め。1 人が列を埋めて、他の人を待たせ続けないように。
      allowGeocode: limiter
        ? async () =>
            (await limiter.limit({ key: request.headers.get("CF-Connecting-IP") ?? "unknown" }))
              .success
        : undefined,
      // 全体の「1 秒 1 回」。送るのは列（Durable Object）自身。
      nominatim: gate
        ? (target, init) => gate.get(gate.idFromName("nominatim")).fetch(target, init)
        : undefined,
      /*
       * 使われているかを数える。**SDK が引数を検査して受け付けた呼び出しだけ**が
       * ここへ来る（引数が足りない・壊れた呼び出しは数えない）。401 を返した呼び出しは
       * 上で止めているので来ない——匿名でスタンプを押そうとしただけでは、まだ
       * 使われていない。書くのは tool 名とサインインの有無だけ（src/lib/usage.ts）。
       */
      onToolCall: (name, args) => recordUsage(env.USAGE, usageEvent(name, args, Boolean(visitor))),
    });
  },
};

/**
 * MCP の応答を作る。**誰として実行するかは呼ぶ側が決める。**
 *
 * 手元の開発サーバー（main.ts）は、ここへ偽のサインイン済み利用者を渡して
 * 会員機能の画面を出す。**その道を上の fetch に入れないこと**——環境変数
 * ひとつで認証を迂回できる口を、本番に出る側へ置くことになる。
 */
export async function serveMcp(request: Request, deps: ServerDeps): Promise<Response> {
  // ステートレスなので、リクエストごとにサーバーとトランスポートを作る。
  const server = createServer(deps);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    /*
     * **受け取った Request をそのまま渡す。作り直さない。**
     * 作り直すと `request.cf`（Cloudflare が付ける接続元の位置）が落ちる。
     * 401 の判定に要る本文は、呼ぶ側が複製から読んでいる。
     */
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
}
