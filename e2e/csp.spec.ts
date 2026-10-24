import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";

const WEB_URL = "http://localhost:3134";

/*
 * 本番の CSP は public/_headers にあり、Cloudflare が静的ページに付ける（#268）。E2E の vite preview は
 * _headers を読まないので、同じ値を HTML の応答に付けて開き、違反が 0 件であることを見る。
 * 地図・カメラ・券売機などが読み込むものを CSP が止めたら、ここで落ちる。
 */
const CSP = readFileSync(new URL("../public/_headers", import.meta.url), "utf8")
  .split("\n")
  .find((line) => line.trim().startsWith("Content-Security-Policy:"))!
  .split(":")
  .slice(1)
  .join(":")
  .trim();

async function withCsp(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.route(`${WEB_URL}/**`, async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": CSP },
    });
  });
  await page.exposeFunction("reportCspViolation", (v: string) => violations.push(v));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as unknown as { reportCspViolation: (v: string) => void }).reportCspViolation(
        `${e.violatedDirective} ${e.blockedURI}`,
      ),
    );
  });
  return violations;
}

/**
 * 読み込みが済むまで待つ。/mcp への接続を開いたままのページがあるので networkidle は来ない。
 * 違反は読み込みの直後に出るので、load の後に少しだけ待って拾う。
 */
async function settle(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(1500);
}

test("public/_headers の CSP に frame-ancestors 'none' がある", () => {
  expect(CSP).toContain("frame-ancestors 'none'");
  expect(CSP).toContain("default-src 'self'");
});

/*
 * Cloudflare Web Analytics は、ダッシュボードの設定でエッジが全ページにスクリプトを差し込む（リポジトリにも
 * E2E にも出てこない）。CSP で止めると、本番だけで計測が消える（#268 のマージ直後に実測）。
 */
test("CSP が Cloudflare Web Analytics のスクリプトと送信先を許している", () => {
  expect(CSP).toMatch(/script-src [^;]*https:\/\/static\.cloudflareinsights\.com/);
  expect(CSP).toMatch(/connect-src [^;]*https:\/\/cloudflareinsights\.com/);
});

for (const path of [
  "/",
  "/match/",
  "/camera/",
  "/shindan/",
  "/area/kanagawa/",
  "/shop/way-548841303/",
  "/connect",
  "/privacy",
]) {
  test(`CSP を付けて ${path} を開いても違反が出ない`, async ({ page }) => {
    const violations = await withCsp(page);
    await page.goto(`${WEB_URL}${path}`);
    await settle(page);
    expect(violations).toEqual([]);
  });
}

test("CSP を付けても、地図で探す（MapLibre のワーカー）で違反が出ない", async ({ page }) => {
  const violations = await withCsp(page);
  await page.goto(WEB_URL);
  await expect(page.locator("main:not([inert])")).toHaveCount(1);
  await page
    .getByRole("navigation", { name: "探し方" })
    .getByRole("button", { name: "地図で" })
    .click();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await settle(page);
  expect(violations).toEqual([]);
});
