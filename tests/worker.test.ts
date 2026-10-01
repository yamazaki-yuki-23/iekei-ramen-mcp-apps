/**
 * HTTP の入口（worker.fetch）のテスト。
 *
 * tool の中身ではなく、**HTTP でしか起きない壊れ方**を見る。tool のテストは
 * InMemoryTransport で直結しているため、ここを通らない——実際、本文の読み方を
 * 間違えて GET /mcp が 500 になっていたのを、どのテストも捕まえられなかった。
 *
 * バインディング（KV・D1）は渡さない。**手元と同じ「匿名だけの環境」**を再現し、
 * そこで落ちないことを確かめる。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker";

const ORIGIN = "http://localhost:3031";

/** バインディングの無い環境。手元の `npx tsx main.ts` と同じ条件。 */
const env = {
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  VISITOR_ID_PEPPER: "",
} as never;

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

const fetchPath = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx);

const rpc = (name: string) =>
  fetchPath("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: {} },
    }),
  });

describe("worker.fetch", () => {
  it("本文を持てない GET でも /mcp が 500 にならない", async () => {
    const response = await fetchPath("/mcp", { method: "GET" });
    // 405 でも 400 でもよい。**サーバー側の例外（500）でなければ通す**。
    expect(response.status).not.toBe(500);
  });

  it("匿名でも検索の tool は呼べる", async () => {
    const response = await rpc("search-iekei-ramen");
    expect(response.status).toBe(200);
  });

  it("Cloudflare が付ける接続元の位置（request.cf）が tool まで届く", async () => {
    /*
     * 401 の判定のために本文を読むとき、Request を作り直すと `cf` が落ちる。
     * 落ちると、位置を渡さないホストから呼ばれた find-nearby が現在地を
     * 見失う（実測: /whereami が Saitama を返す本番で origin が null になった）。
     */
    const request = new Request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "find-nearby-iekei-ramen", arguments: { limit: 1 } },
      }),
    });
    // Workers が付けてくる非標準の欄。手元では自分で載せて同じ形にする。
    Object.defineProperty(request, "cf", {
      value: { latitude: "35.4657", longitude: "139.6220", city: "Yokohama", region: "Kanagawa" },
    });

    const body = await (await worker.fetch(request, env, ctx)).text();
    const origin = JSON.parse(body.slice(body.indexOf("data: ") + 6).split("\n")[0]).result
      .structuredContent.query.origin;

    expect(origin).toMatchObject({ source: "edge", label: "Yokohama Kanagawa" });
  });

  it("匿名でスタンプの tool を呼ぶと 401 とサインインの案内が返る", async () => {
    const response = await rpc("stamp-iekei-ramen");
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      `${ORIGIN}/.well-known/oauth-protected-resource`,
    );
    /*
     * **401 にも CORS が要る。** 別の origin で動くブラウザのクライアントは、
     * ヘッダが無いと応答ごと捨てるので「通信に失敗した」としか見えず、
     * サインインが始まらない。案内の中身（WWW-Authenticate）も、読めるように
     * 明示しないと隠れる。
     */
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("WWW-Authenticate");
  });

  it("401 が指す先が実在し、認可サーバーの在り処を示す", async () => {
    // 401 の指す URL が 404 だと、ホストはサインインの入口へ辿り着けない。
    const challenge = await rpc("stamp-iekei-ramen");
    const target = challenge.headers
      .get("WWW-Authenticate")
      ?.match(/resource_metadata="([^"]+)"/)?.[1];
    expect(target).toBe(`${ORIGIN}/.well-known/oauth-protected-resource`);

    const response = await fetchPath(new URL(target!).pathname);
    expect(response.status).toBe(200);
    const metadata = (await response.json()) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
    };
    expect(metadata.resource).toBe(`${ORIGIN}/mcp`);
    expect(metadata.authorization_servers).toEqual([ORIGIN]);
    expect(metadata.scopes_supported).toContain("stamp");
  });

  it("資源メタデータは道つきの形でも返る", async () => {
    // 資源に道があるとき、こちらを先に見に来るホストがある。
    const response = await fetchPath("/.well-known/oauth-protected-resource/mcp");
    expect(response.status).toBe(200);
  });

  it("KV の無い環境では、サインインの道が落ちずに 501 を返す", async () => {
    // 認可サーバーは `cloudflare:workers` を取り込む。**読み込むとプロセスが落ちる**
    // ので、手前で断る。ここが通らないと手元の開発サーバーが死ぬ。
    for (const path of [
      "/authorize",
      "/callback/google",
      "/.well-known/oauth-authorization-server",
    ]) {
      const response = await fetchPath(path);
      expect(response.status, path).toBe(501);
    }
  });
});

/** 列の Durable Object の代わり。受け取った問い合わせを記録し、決めた状態で答える。 */
function gateAnswering(status: number) {
  const received: Request[] = [];
  return {
    received,
    GEOCODE_GATE: {
      idFromName: () => "nominatim",
      get: () => ({
        fetch: async (url: string, init?: RequestInit) => {
          received.push(new Request(url, init));
          return Response.json([], { status });
        },
      }),
    },
  };
}

const geocode = (gateEnv: object) =>
  worker.fetch(
    new Request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "geocode-place", arguments: { query: "横浜駅" } },
      }),
    }),
    { ...(env as object), ...gateEnv } as never,
    ctx,
  );

describe("地名検索の列（GEOCODE_GATE）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Nominatim へは列を通して送り、Worker から直接は送らない", async () => {
    const direct = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", direct);
    const gate = gateAnswering(200);

    await (await geocode({ GEOCODE_GATE: gate.GEOCODE_GATE })).text();
    expect(direct).not.toHaveBeenCalled();
    expect(gate.received).toHaveLength(1);
    expect(gate.received[0].url).toMatch(/^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
    expect(gate.received[0].headers.get("User-Agent")).toMatch(/^iekei-ramen-mcp-apps\//);
  });

  it("列が断ったら（429）、混み合っていると返す", async () => {
    const body = await (await geocode({ GEOCODE_GATE: gateAnswering(429).GEOCODE_GATE })).text();
    expect(body).toContain('"isError":true');
    expect(body).toContain("混み合っています");
  });
});

/** 書かれたものを貯める、偽の Analytics Engine。 */
const withUsage = (writeDataPoint: (p?: AnalyticsEngineDataPoint) => void) =>
  ({
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    VISITOR_ID_PEPPER: "",
    USAGE: { writeDataPoint },
  }) as never;

const callBody = (name: string, args: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name, arguments: args },
});

const post = (
  usageEnv: never,
  name: string,
  args: Record<string, unknown>,
  { batch = false } = {},
) =>
  worker.fetch(
    new Request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        // 接続元の IP。**書いてはいけないもの**の代表として渡しておく。
        "CF-Connecting-IP": "203.0.113.7",
      },
      body: JSON.stringify(batch ? [callBody(name, args)] : callBody(name, args)),
    }),
    usageEnv,
    ctx,
  );

describe("使われているかを数える（USAGE）", () => {
  it("tool を呼ぶと 1 件書き、引数も IP も書かない", async () => {
    const points: AnalyticsEngineDataPoint[] = [];
    const response = await post(
      withUsage((p) => p && points.push(p)),
      "search-iekei-ramen",
      {
        prefecture: "神奈川県",
        keyword: "横浜駅",
      },
    );
    expect(response.status).toBe(200);
    expect(points).toHaveLength(1);
    expect(points[0].blobs?.[0]).toBe("search-iekei-ramen");
    const written = JSON.stringify(points);
    for (const secret of ["神奈川県", "横浜駅", "203.0.113.7"]) {
      expect(written, `「${secret}」を書いている`).not.toContain(secret);
    }
  });

  it("匿名のスタンプ（401 を返すもの）は数えない", async () => {
    // まだ使われていない。サインインを求めただけ。
    const points: AnalyticsEngineDataPoint[] = [];
    const response = await post(
      withUsage((p) => p && points.push(p)),
      "stamp-iekei-ramen",
      {
        shopId: "node/1",
        visited: true,
      },
    );
    expect(response.status).toBe(401);
    expect(points).toHaveLength(0);
  });

  it("引数が足りず SDK が弾いた呼び出しは数えない", async () => {
    // 本文を読んで数えると、受け付けていない呼び出しまで「使われた」になる。
    const points: AnalyticsEngineDataPoint[] = [];
    const response = await post(
      withUsage((p) => p && points.push(p)),
      "geocode-place",
      {},
    );
    expect(await response.text()).toContain("isError");
    expect(points).toHaveLength(0);
  });

  it("配列に包んだ匿名のスタンプも 401 で止め、数えない", async () => {
    // 1 件の形だけ見ていると、配列に包むだけでサインインの確認をすり抜ける。
    const points: AnalyticsEngineDataPoint[] = [];
    const response = await post(
      withUsage((p) => p && points.push(p)),
      "stamp-iekei-ramen",
      { shopId: "node/1", visited: true },
      { batch: true },
    );
    expect(response.status).toBe(401);
    expect(points).toHaveLength(0);
  });

  it("書き込みが投げても、検索の応答は返る", async () => {
    const response = await post(
      withUsage(() => {
        throw new Error("over the limit");
      }),
      "search-iekei-ramen",
      {},
    );
    expect(response.status).toBe(200);
  });
});
