import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";

const WEB_URL = "http://localhost:3134";

/*
 * 本番の CSP は public/_headers にあり、Cloudflare が静的ページに付ける（#268）。E2E の vite preview は
 * _headers を読まないので、同じ値を HTML の応答に付けて開き、違反が 0 件であることを見る。
 * 地図・カメラ・券売機などが読み込むものを CSP が止めたら、ここで落ちる。
 */
/** public/_headers の `/*` の段のヘッダー（CSP・Permissions-Policy など、#428）。 */
const HEADERS = (() => {
  const lines = readFileSync(new URL("../public/_headers", import.meta.url), "utf8").split("\n");
  const block = lines.slice(lines.indexOf("/*") + 1);
  const end = block.findIndex((line) => !line.startsWith("  "));
  return Object.fromEntries(
    block
      .slice(0, end)
      .filter((line) => !line.trim().startsWith("#"))
      .map((line) => {
        const at = line.indexOf(":");
        return [line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim()];
      }),
  ) as Record<string, string>;
})();
const CSP = HEADERS["content-security-policy"];

async function withCsp(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.route(`${WEB_URL}/**`, async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), ...HEADERS },
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

test("静的ページのヘッダーで、使う機能（位置情報・カメラ・共有・コピー）は許し、ほかは閉じる（#428）", async ({
  page,
}) => {
  expect(HEADERS["x-content-type-options"]).toBe("nosniff");
  expect(HEADERS["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  // 共有は既定で自分の origin に許されるので書かない（#433）。
  expect(HEADERS["permissions-policy"]).not.toContain("web-share");
  const violations = await withCsp(page);
  await page.goto(`${WEB_URL}/`);
  await settle(page);
  const allows = await page.evaluate(() => {
    const policy = (
      document as unknown as {
        featurePolicy: { allowsFeature(f: string): boolean; features(): string[] };
      }
    ).featurePolicy;
    // ブラウザが知らない機能は比べない（テストの Chromium には共有 web-share が無い。ヘッダー無しでも false）。
    const known = policy.features();
    return Object.fromEntries(
      ["geolocation", "camera", "web-share", "clipboard-write", "microphone", "payment", "usb"]
        .filter((feature) => known.includes(feature))
        .map((feature) => [feature, policy.allowsFeature(feature)]),
    );
  });
  expect(allows).toMatchObject({
    geolocation: true,
    camera: true,
    "clipboard-write": true,
    microphone: false,
    payment: false,
    usb: false,
  });
  if ("web-share" in allows) expect(allows["web-share"]).toBe(true);
  expect(violations).toEqual([]);
});

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
