/**
 * 店のページ（#255）。初めて来た人が行き止まりにならず、その場で誤りを報告できる。
 * 報告の受け口（/reports）は E2E の静的サーバーに無いので、ブラウザで受けて数える。
 */
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";

const SHOP = "http://localhost:3134/shop/way-884336378/";
test.use({ viewport: { width: 390, height: 844 } });

/** /reports への POST を数え、ms 遅らせてから status と message を返す。 */
async function answerReports(page: Page, status: number, message: string, ms = 300) {
  const bodies: unknown[] = [];
  await page.route("**/reports", async (route) => {
    bodies.push(route.request().postDataJSON());
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ message }),
    });
  });
  return bodies;
}

test("道順が主のボタンで、近い家系 3 軒と「この情報について」がある", async ({ page }) => {
  await page.goto(SHOP);
  const directions = page.getByRole("link", { name: "Google マップで道順を見る" });
  await expect(directions).toHaveAttribute(
    "href",
    /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/,
  );
  await expect(directions).toBeInViewport();
  await expect(page.getByRole("link", { name: /注文のしかたを見る/ })).toBeVisible();
  await expect(page.locator(".seo-nearby > li")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "この情報について" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test("報告は 1 回押したら送り終わるまでどのボタンも押せず、2 度押しても 1 件だけ送る", async ({
  page,
}) => {
  const bodies = await answerReports(
    page,
    201,
    "受け取りました。反映は確認してからなので時間がかかります",
  );
  await page.goto(SHOP);
  const closed = page.getByRole("button", { name: "閉店している" });
  await closed.click();
  for (const name of ["閉店している", "家系ではない", "場所が違う"])
    await expect(page.getByRole("button", { name })).toBeDisabled();
  await closed.click({ force: true });
  await expect(page.getByRole("status")).toHaveText(
    "受け取りました。反映は確認してからなので時間がかかります",
  );
  // 受け取ったあとも押せないまま（同じ店に続けて送らせない）。
  await expect(page.getByRole("button", { name: "場所が違う" })).toBeDisabled();
  expect(bodies).toEqual([{ kind: "closed", shopId: "way/884336378" }]);
});

test("送れなかったときは受け口の理由を出し、もう一度押せる", async ({ page }) => {
  const bodies = await answerReports(
    page,
    429,
    "短時間に報告が集中しています。1分後にお試しください",
  );
  await page.goto(SHOP);
  await page.getByRole("button", { name: "場所が違う" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "短時間に報告が集中しています。1分後にお試しください",
  );
  await expect(page.getByRole("button", { name: "場所が違う" })).toBeEnabled();
  expect(bodies).toEqual([{ kind: "wrong-location", shopId: "way/884336378" }]);
});
