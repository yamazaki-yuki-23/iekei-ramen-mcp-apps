/**
 * スライドと README に載せる操作デモの動画を撮る。
 *
 * 横長のビューポートで撮っている。正方形に近いと、スライドに置いたときに
 * 高さで頭打ちになって小さくしか見えないため。
 * video の test.use は describe 内に書けないので、ファイルを分けている。
 */
import { expect, test } from "@playwright/test";
import { callTool, shopCards, waitForApp } from "./helpers";

test.use({
  viewport: { width: 1140, height: 660 },
  video: { mode: "on", size: { width: 1140, height: 660 } },
});

test("デモ", async ({ page }) => {
  const app = await callTool(page, "search-iekei-ramen");
  await waitForApp(app);
  await expect(shopCards(app).first()).toBeVisible();
  await page.waitForTimeout(3000);

  // 検索フォームで絞り込む
  await app.locator("#pref").selectOption("神奈川県");
  await page.waitForTimeout(600);
  await app.getByRole("button", { name: "直系・濃厚", exact: true }).click();
  await page.waitForTimeout(400);
  await app.getByRole("button", { name: "検索" }).click();
  await expect(app.getByRole("heading", { name: /神奈川県の家系ラーメン/ })).toBeVisible();
  await page.waitForTimeout(2000);

  // 現在地から探す
  await app.getByRole("tab", { name: "現在地から探す" }).click();
  await page.waitForTimeout(1000);
  await app.locator("#place").fill("横浜駅");
  await page.waitForTimeout(600);
  await app.getByRole("button", { name: "この場所で探す" }).click();
  await expect(shopCards(app)).toHaveCount(5);
  await page.waitForTimeout(2500);

  // 迷ったら — 3 軒に絞ってモデルに推させる
  await app.getByRole("tab", { name: "迷ったら" }).click();
  await expect(shopCards(app)).toHaveCount(3);
  await page.waitForTimeout(2500);
  await app.getByRole("button", { name: "別の候補を見る" }).click();
  await page.waitForTimeout(2000);

  // まわる店 — 2 軒を積んで順路を出す
  await shopCards(app).nth(1).click();
  await page.waitForTimeout(800);
  await app.getByRole("button", { name: "まわる店に追加" }).click();
  await page.waitForTimeout(600);
  await shopCards(app).nth(0).click();
  await page.waitForTimeout(600);
  await app.getByRole("button", { name: "まわる店に追加" }).click();
  await app.getByRole("button", { name: "選択を解除" }).click();
  await expect(app.getByRole("region", { name: "まわる店" })).toBeVisible();
  await page.waitForTimeout(3000);

  // 地図から探す — 順路の線も出る
  await app.getByRole("tab", { name: "地図から探す" }).click();
  await expect(app.getByRole("application", { name: "家系ラーメン店の地図" })).toBeVisible();
  await page.waitForTimeout(4000);
  await app.locator("#pref").selectOption("東京都");
  await page.waitForTimeout(3500);
});
