/**
 * README 用のスクリーンショットとデモ動画を撮る。
 * 通常の E2E とは別扱いで、`npm run capture` から実行する。
 */
import { expect, test } from "@playwright/test";
import { callTool, shopCards, waitForApp } from "./helpers";

test.use({
  viewport: { width: 900, height: 760 },
  video: { mode: "on", size: { width: 900, height: 760 } },
  deviceScaleFactor: 2,
});

/** ホスト側の枠を隠して、アプリの iframe だけを撮る。 */
async function shot(page: import("@playwright/test").Page, name: string) {
  const frame = page.locator("iframe").first();
  await frame.screenshot({ path: `docs/${name}.png` });
}

test("検索フォーム", async ({ page }) => {
  const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
  await waitForApp(app);
  await expect(shopCards(app).first()).toBeVisible();
  await shot(page, "search");
});

test("現在地から探す", async ({ page }) => {
  const app = await callTool(page, "find-nearby-iekei-ramen", {
    lat: 35.4658,
    lon: 139.6222,
    limit: 5,
    label: "横浜駅",
  });
  await waitForApp(app);
  await expect(shopCards(app)).toHaveCount(5);
  await shot(page, "nearby");
});

test("地図から探す", async ({ page }) => {
  const app = await callTool(page, "show-iekei-ramen-map");
  await waitForApp(app);
  await expect(app.getByRole("application", { name: "家系ラーメン店の地図" })).toBeVisible();
  // タイルの読み込みを待ってから撮る
  await page.waitForTimeout(4000);
  await shot(page, "map");
});
