/**
 * 地図が画面の下に見切れていても、最初の 1 回の押下が届くこと（#58）。
 *
 * Leaflet は地図に焦点が無いときに押されると、地図の枠へ `focus()` する。枠が
 * 見切れていると、ブラウザが外側のページ（ホスト）をスクロールして枠を見せようとし、
 * 押してから離すまでの間に中身がずれて、`mouseup` が地図の地に落ちる
 * （実測: 高さ 720 で外側のページが 0 → 133px スクロールし、塊が開かなかった）。
 *
 * E2E の既定の画面は縦に長いので見切れない。ここだけ高さ 720 で、見切れた状態を
 * 意図して作る。
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { callTool, smallestCluster, waitForApp } from "./helpers";

test("地図が画面の下に見切れていても、塊を押せば開く", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const app = await callTool(page, "show-iekei-ramen-map");
  await waitForApp(app);

  /*
   * **押す塊は、先に画面へ収めておく。** Playwright の click は、押す前に対象を
   * 画面へ収めようとしてページを動かす（実測: 画面の下端近くの塊で 12px）。
   * それを押下のせいと取り違えないよう、動かし終えてから測り始める。
   */
  const { pin, size } = await smallestCluster(app);
  await pin.scrollIntoViewIfNeeded();

  /*
   * **前提: 地図の枠が画面の下に見切れていること。** 見切れていなければ、この
   * テストは何も見ない。ホストは iframe の高さをあとから決めるので、見切れる
   * ところまで伸びるのを待つ。塊を画面へ収めたあとで確かめる。
   */
  const container = app.locator(".leaflet-container");
  await expect
    .poll(
      async () => {
        const box = await container.boundingBox();
        return box ? box.y + box.height : 0;
      },
      { message: "地図の枠が画面の下に見切れていない" },
    )
    .toBeGreaterThan(720);
  const before = await page.evaluate(() => scrollY);

  await pin.click();

  // 押した塊の中身が一覧に出る＝塊が押された。
  await expect(app.getByText(`この地点の ${size} 軒`, { exact: false })).toBeVisible();
  // 外側のページは動かない。動くと、押してから離すまでの間に中身がずれる。
  expect(await page.evaluate(() => scrollY), "押した拍子に外側のページが動いた").toBe(before);
});
