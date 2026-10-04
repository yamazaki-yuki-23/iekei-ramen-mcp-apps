import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import { test as base } from "./fixtures";
import { createOAuthHarness } from "../tests/fixtures/oauth-harness";

const REDIRECT = "https://client.test/callback";
const test = base.extend<{ oauthOrigin: string }>({
  oauthOrigin: async ({ browser: _browser }, use) => {
    const { harness, close } = createOAuthHarness();
    try {
      const { url } = await harness.listen();
      await use(url.origin);
    } finally {
      await close();
    }
  },
});

for (const decision of ["approve", "deny"] as const) {
  test(`同意フォームの${decision}で外部の認証先へ移動できる`, async ({ page, oauthOrigin }) => {
    // 公開サーバーやGoogleには出さず、ブラウザによるCSP・Cookieの評価を通す。
    // page.routeはリダイレクト後のURLを横取りしないので、CDPで各転送先を止める。
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "https://*" }] });
    cdp.on("Fetch.requestPaused", async ({ requestId, request }) => {
      const origin = new URL(request.url).origin;
      const body =
        origin === "https://accounts.google.com"
          ? "Googleへの転送に成功"
          : origin === "https://client.test"
            ? "クライアントへの転送に成功"
            : null;
      if (body === null) {
        await cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
      } else {
        await cdp.send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
          body: Buffer.from(body).toString("base64"),
        });
      }
    });
    const registration = await page.request.post(`${oauthOrigin}/register`, {
      data: {
        client_name: "ローカルブラウザ確認",
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      },
    });
    expect(registration.status()).toBe(201);
    const { client_id } = await registration.json();
    const authorize = new URL("/authorize", oauthOrigin);
    authorize.search = new URLSearchParams({
      client_id,
      redirect_uri: REDIRECT,
      response_type: "code",
      scope: "stamp",
      state: "browser-test-state",
      resource: `${oauthOrigin}/mcp`,
      code_challenge: createHash("sha256")
        .update("local-browser-verifier-abcdefghijklmnopqrstuvwxyz0123456789")
        .digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    await page.goto(authorize.href);
    const cookies = await page.context().cookies();
    expect(cookies.filter((cookie) => cookie.name.startsWith("__Host-oauth-consent"))).toHaveLength(
      1,
    );
    const name = decision === "approve" ? "許可してGoogleへ進む" : "拒否する";
    await page.getByRole("button", { name, exact: true }).click();
    if (decision === "approve") {
      await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
      await expect(page.getByText("Googleへの転送に成功")).toBeVisible();
      expect(new URL(page.url()).searchParams.get("scope")).toBe("openid");
    } else {
      await expect(page).toHaveURL(/^https:\/\/client\.test\/callback\?/);
      await expect(page.getByText("クライアントへの転送に成功")).toBeVisible();
      expect(new URL(page.url()).searchParams.get("error")).toBe("access_denied");
      expect(new URL(page.url()).searchParams.get("state")).toBe("browser-test-state");
    }
    expect(
      (await page.context().cookies()).filter((cookie) =>
        cookie.name.startsWith("__Host-oauth-consent"),
      ),
    ).toHaveLength(0);
  });
}
