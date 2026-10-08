import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOAuthHarness } from "./fixtures/oauth-harness";

const ORIGIN = "http://localhost";
const REDIRECT = "https://client.test/callback";
const VERIFIER = "local-test-verifier-abcdefghijklmnopqrstuvwxyz0123456789";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const { harness, close } = createOAuthHarness();

const request = (path: string, init?: RequestInit) =>
  harness.fetch(`${ORIGIN}${path}`, { ...init, redirect: "manual" });
async function register(name = "ローカルMCPクライアント", redirect = REDIRECT) {
  const response = await request("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}
const authorizePath = (client: string, redirect = REDIRECT) =>
  `/authorize?${new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: "code", scope: "stamp", state: "original-state", resource: `${ORIGIN}/mcp`, code_challenge: CHALLENGE, code_challenge_method: "S256" })}`;
const cookiesOf = (r: Response) =>
  r.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
async function open(client: string, redirect = REDIRECT) {
  const response = await request(authorizePath(client, redirect));
  expect(response.status).toBe(200);
  const html = await response.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)?.[1];
  expect(handle).toBeTruthy();
  return { response, html, handle: handle!, cookie: cookiesOf(response) };
}
const decide = (handle: string, cookie: string, decision = "approve", extra = {}) =>
  request("/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: new URLSearchParams({ handle, decision, ...extra }),
  });

beforeAll(async () => {
  await harness.listen();
  await harness.getWorker().applyD1Migrations("VISITS");
}, 60_000);
afterAll(async () => {
  await close();
}, 30_000);

describe("workerdでのクライアントごとの同意", () => {
  it("URL形式のクライアントIDはHTTPSスキームの大小文字で表示が変わらない", async () => {
    const env = await harness.getWorker<{ OAUTH_KV: KVNamespace }>().getEnv();
    const client = "HTTPS://publisher.test/metadata";
    // URL形式の登録済みclientもライブラリのKV読み取り経路で扱える。
    await env.OAUTH_KV.put(
      `client:${client}`,
      JSON.stringify({
        clientId: client,
        clientName: "URLクライアント",
        redirectUris: [REDIRECT],
        tokenEndpointAuthMethod: "none",
        grantTypes: ["authorization_code"],
        responseTypes: ["code"],
      }),
    );
    const page = await open(client);
    expect(page.html).toContain("公開元: publisher.test");
    expect(page.html).not.toContain("接続元の自己申告");
  });
  it("Googleへ送る前にクライアント・戻り先・権限を示し、HTMLとiframeを防ぐ", async () => {
    const client = await register('<script>alert("x")</script>');
    const page = await open(client);
    expect(page.response.headers.get("Location")).toBeNull();
    expect(page.html).not.toContain("<script>");
    expect(page.html).toContain("&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62;");
    expect(page.html).toContain("client.test");
    for (const word of ["閲覧", "変更", "全削除"]) expect(page.html).toContain(word);
    expect(page.response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(page.response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(page.response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("拒否すると検証済みのclientへaccess_deniedと元のstateを返す", async () => {
    const page = await open(await register());
    const response = await decide(page.handle, page.cookie, "deny");
    expect(response.status).toBe(302);
    const to = new URL(response.headers.get("Location")!);
    expect(to.origin + to.pathname).toBe(REDIRECT);
    expect(to.searchParams.get("error")).toBe("access_denied");
    expect(to.searchParams.get("state")).toBe("original-state");
    expect((await decide(page.handle, page.cookie)).status).toBe(400);
  });

  it.each([
    ["https://client.test;script-src/callback", "https://client.test%3Bscript-src"],
    ["https://client.test,other.test/callback", "https://client.test%2Cother.test"],
    ["https://*.client.test/callback", "https://%2A.client.test"],
  ])("戻り先 %s の区切り文字や星でCSPの許可を広げない", async (redirect, source) => {
    const page = await open(await register("区切り文字の検証", redirect), redirect);
    const policy = page.response.headers.get("Content-Security-Policy")!;
    expect(policy).toContain(source);
    expect(policy).not.toContain(";script-src");
    expect(policy).not.toContain(",");
    expect(policy).not.toContain("*");
    expect(policy).toContain("default-src 'none'");
  });

  it("cookieなし・不正handle・別ブラウザ・別originの承認ではGoogleへ進まない", async () => {
    const page = await open(await register());
    const other = await open(await register());
    for (const [handle, cookie] of [
      [page.handle, ""],
      ["forged", page.cookie],
      [page.handle, other.cookie],
    ]) {
      const response = await decide(handle, cookie);
      expect(response.status).toBe(400);
      expect(response.headers.get("Location")).toBeNull();
    }
    const crossSite = await request("/authorize", {
      method: "POST",
      headers: {
        Origin: "https://attacker.test",
        Cookie: page.cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ handle: page.handle, decision: "approve" }),
    });
    expect(crossSite.status).toBe(403);
  });

  it("承認後だけGoogleへ進み、別clientのフォーム値で宛先を差し替えられない", async () => {
    const first = await register();
    const other = await register("別のクライアント", "https://other.test/callback");
    const page = await open(first);
    const approved = await decide(page.handle, page.cookie, "approve", {
      client_id: other,
      redirect_uri: "https://other.test/callback",
    });
    expect(approved.status).toBe(302);
    const to = new URL(approved.headers.get("Location")!);
    expect(to.origin).toBe("https://accounts.google.com");
    expect(to.searchParams.get("scope")).toBe("openid");
    expect((await decide(page.handle, page.cookie)).status).toBe(400);
    const callback = await request(
      `/callback/google?${new URLSearchParams({ state: to.searchParams.get("state")!, error: "access_denied" })}`,
      { headers: { Cookie: cookiesOf(approved) } },
    );
    expect(new URL(callback.headers.get("Location")!).origin).toBe("https://client.test");
    await open(other, "https://other.test/callback");
  });

  it("同意なしのcallback・未登録clientで認可を完了できず、匿名検索は動く", async () => {
    const callback = await request("/callback/google?state=forged&code=forged");
    expect(callback.status).toBe(400);
    expect(callback.headers.get("Location")).toBeNull();
    expect((await request(authorizePath("unknown"))).status).toBe(400);
    const search = await request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search-iekei-ramen", arguments: {} },
      }),
    });
    expect(search.status).toBe(200);
  });

  it("承認・Google本人確認・PKCE交換の後にだけ実D1の訪問記録を操作できる", async () => {
    const client = await register();
    const page = await open(client);
    const approved = await decide(page.handle, page.cookie);
    const upstream = new URL(approved.headers.get("Location")!);
    const callback = await request(
      `/callback/google?${new URLSearchParams({ code: "local-code", state: upstream.searchParams.get("state")! })}`,
      { headers: { Cookie: cookiesOf(approved) } },
    );
    expect(callback.status).toBe(302);
    const back = new URL(callback.headers.get("Location")!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("original-state");
    const exchanged = await request("/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client,
        code: back.searchParams.get("code")!,
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
        resource: `${ORIGIN}/mcp`,
      }),
    });
    expect(exchanged.status).toBe(200);
    const { access_token: token } = (await exchanged.json()) as { access_token: string };
    expect(token).toBeTruthy();
    const shops = JSON.parse(
      readFileSync(new URL("../data/shops.json", import.meta.url), "utf8"),
    ) as { id: string }[];
    const shopId = shops[0].id;
    const call = async (name: string, args = {}, bearer = token) => {
      const response = await request("/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      if (response.status !== 200) return { status: response.status, visited: [] };
      const body = await response.text();
      const message = JSON.parse(body);
      expect(message.result.isError).not.toBe(true);
      return { status: response.status, visited: message.result.structuredContent.visited };
    };
    expect((await call("stamp-iekei-ramen", { shopId, visited: true }, "")).status).toBe(401);
    expect(
      (await call("stamp-iekei-ramen", { shopId, visited: true }, "forged-token")).status,
    ).toBe(401);
    expect(
      (await call("stamp-iekei-ramen", { shopId, visited: true }, `${token}tampered`)).status,
    ).toBe(401);
    expect((await call("stamp-iekei-ramen", { shopId, visited: true })).visited).toContain(shopId);
    const env = await harness.getWorker<{ VISITS: D1Database }>().getEnv();
    const stored = await env.VISITS.prepare("SELECT user_id, shop_id FROM visits").all();
    // Googleの本人確認からtokenのprops、Worker、MCP、D1まで同じ利用者が届く。
    const expectedId = createHmac("sha256", "local-test-pepper")
      .update("local-consent-user")
      .digest("hex");
    expect(stored.results).toEqual([{ user_id: expectedId, shop_id: shopId }]);
    expect((await call("show-visited-iekei-ramen")).visited).toContain(shopId);
    expect((await call("forget-my-iekei-ramen-visits", { confirm: true })).visited).toEqual([]);
  });

  it("未登録clientのtoken要求を拒否し、訪問記録を作らない", async () => {
    const response = await request("/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "unregistered-client",
        code: "forged-code",
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
        resource: `${ORIGIN}/mcp`,
      }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "invalid_client" });
    const env = await harness.getWorker<{ VISITS: D1Database }>().getEnv();
    expect((await env.VISITS.prepare("SELECT * FROM visits").all()).results).toEqual([]);
  });
});
