/**
 * 認証まわりのうち、**KV を立てずに確かめられるところ**だけを見る。
 *
 * 認可サーバー本体は `cloudflare:workers` を取り込むので Node では動かせない。
 * 認可サーバー本体とWorkerの実HTTP経路は oauth-consent.test.ts の
 * workerd・ローカルKV/D1で検証する。Googleの交換だけを偽物に置き換える。
 */
import { describe, expect, it } from "vitest";
import {
  authorizeFailure,
  backToClient,
  exchangeForSubject,
  isOAuthPath,
  isResourceMetadataPath,
} from "../oauth";

describe("authorizeFailure", () => {
  it("戻り先が分かっているときは、理由を付けてそこへ戻す", () => {
    const response = authorizeFailure({
      code: "invalid_request",
      description: "resource is unknown",
      redirectUri: "https://example.com/cb",
      state: "xyz",
    });
    expect(response.status).toBe(302);
    const back = new URL(response.headers.get("Location") ?? "");
    expect(back.searchParams.get("error")).toBe("invalid_request");
    expect(back.searchParams.get("error_description")).toBe("resource is unknown");
    expect(back.searchParams.get("state")).toBe("xyz");
  });

  it("戻り先が分からないときは 400。**500 にしない**", () => {
    // 未登録の client_id で実際に 500 になっていた。ホストが登録からやり直せるよう、
    // 理由の分かる 400 を返す。
    const response = authorizeFailure({
      code: "invalid_client",
      description: "client not found",
    });
    expect(response.status).toBe(400);
  });

  it("知らない失敗は握り潰さずに投げ直す", () => {
    expect(() => authorizeFailure(new TypeError("想定外"))).toThrow(TypeError);
  });
});

describe("道の振り分け", () => {
  it("資源メタデータは認可サーバーの道に混ぜない", () => {
    // 混ぜるとライブラリに渡り、404 になる（本番で踏んだ）。
    expect(isResourceMetadataPath("/.well-known/oauth-protected-resource")).toBe(true);
    expect(isResourceMetadataPath("/.well-known/oauth-protected-resource/mcp")).toBe(true);
    expect(isOAuthPath("/authorize")).toBe(false);
    expect(isOAuthPath("/.well-known/oauth-authorization-server")).toBe(true);
  });
});

describe("backToClient", () => {
  it("ホストの戻り先へ error を付けて返す", () => {
    /*
     * Google で断られたときに画面へ 400 を出して終わると、ホストから見た認可が
     * いつまでも終わらない（実測: 本番で access_denied を返すと「認可コードが
     * ありません」の 400 だけが出て、ホストには何も届かなかった）。
     */
    const response = backToClient(
      { redirectUri: "https://example.com/cb", state: "hostState123" },
      new Headers(),
      "access_denied",
      "ユーザーが許可しませんでした",
    );

    expect(response.status).toBe(302);
    const back = new URL(response.headers.get("Location") ?? "");
    expect(back.origin + back.pathname).toBe("https://example.com/cb");
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("state")).toBe("hostState123");
  });

  it("戻り先が分からないときだけ画面に出して終わる", () => {
    // 確かめていない URL へ飛ばさない。戻り先が無いなら飛ばしようがない。
    expect(backToClient({}, new Headers(), "server_error", "理由").status).toBe(400);
  });
});

/** ヘッダだけの id_token（署名はこの経路では確かめない）。 */
const idToken = (sub: string) =>
  `x.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.y`;

describe("exchangeForSubject", () => {
  const env = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" };
  const run = (fetchImpl: typeof fetch) =>
    exchangeForSubject(env, "https://example.com", "code-1", fetchImpl);

  it("通信そのものが失敗しても、投げずに理由を返す", async () => {
    /*
     * ここで投げると Worker のエラー画面が出るだけで、**ホストから見た認可が
     * 終わらないまま残る**。ユーザーには「サインインが進まない」としか見えない。
     */
    const result = await run(() => Promise.reject(new TypeError("network")));
    expect(result).toEqual({ error: "server_error", description: "Google と通信できませんでした" });
  });

  it("Google が失敗を返したときも理由を返す", async () => {
    const result = await run(async () => new Response("no", { status: 400 }));
    expect(result).toMatchObject({ error: "server_error" });
  });

  it("id_token が無ければ利用者を特定できないと返す", async () => {
    const result = await run(async () => Response.json({}));
    expect(result).toMatchObject({ error: "server_error" });
  });

  it("取れたら sub を返す", async () => {
    const result = await run(async () => Response.json({ id_token: idToken("google-sub-1") }));
    expect(result).toEqual({ sub: "google-sub-1" });
  });
});
