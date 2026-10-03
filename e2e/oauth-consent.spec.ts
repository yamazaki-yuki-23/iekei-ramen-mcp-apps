import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createOAuthHarness } from "../tests/fixtures/oauth-harness";

test("許可画面は明暗・狭い画面でも44px以上のボタンとキーボードの焦点を保つ", async ({ page }) => {
  const { harness, close } = createOAuthHarness();
  try {
    await harness.listen();
    const origin = "http://localhost";
    const registered = await harness.fetch(`${origin}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "検証用クライアント",
        redirect_uris: ["https://client.test/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(registered.status).toBe(201);
    const { client_id: client } = (await registered.json()) as { client_id: string };
    const params = new URLSearchParams({
      client_id: client,
      redirect_uri: "https://client.test/callback",
      response_type: "code",
      scope: "stamp",
      state: "browser-test",
      resource: `${origin}/mcp`,
      code_challenge: createHash("sha256")
        .update("browser-test-verifier-abcdefghijklmnopqrstuvwxyz0123456789")
        .digest("base64url"),
      code_challenge_method: "S256",
    });
    // 実WorkerのHTMLとCSPをブラウザへ渡す。外部サーバーやGoogleへ通信しない。
    await page.route(`${origin}/authorize**`, async (route) => {
      const response = await harness.fetch(route.request().url(), { redirect: "manual" });
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 720 });
        await page.goto(`${origin}/authorize?${params}`);
        for (const name of ["許可してGoogleへ進む", "拒否する"]) {
          const button = page.getByRole("button", { name });
          const box = await button.boundingBox();
          expect(box!.height).toBeGreaterThanOrEqual(44);
          expect(box!.width).toBeGreaterThanOrEqual(44);
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0);
        const approve = page.getByRole("button", { name: "許可してGoogleへ進む" });
        await page.keyboard.press("Tab");
        await expect(approve).toBeFocused();
        await expect(approve).toHaveCSS("outline-width", "3px");
        await expect(approve).toHaveCSS("outline-color", "rgb(255, 212, 61)");
        await page.keyboard.press("Tab");
        await expect(page.getByRole("button", { name: "拒否する" })).toBeFocused();
      }
    }
  } finally {
    await close();
  }
});
