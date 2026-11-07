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
  const order = page.getByRole("link", { name: /注文のしかたを見る/ });
  await expect(order).toHaveAttribute("href", "/guide/");
  await expect(page.locator(".seo-nearby > li")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "この情報について" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test("報告の種類を 1 回押しただけでは送らず、その場で確かめる（#365）", async ({ page }) => {
  const bodies = await answerReports(page, 201, "受け取りました。");
  await page.goto(SHOP);
  await page.getByRole("button", { name: "家系ではない" }).click();
  await expect(page.getByText("「家系ではない」として送りますか？")).toBeVisible();
  await expect(page.getByRole("button", { name: "送る", exact: true })).toBeFocused();
  // 少し待っても受け口へは何も届かない。
  await page.waitForTimeout(500);
  expect(bodies).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test("「やめる」で何も送らずに戻り、焦点は押した種類へ戻る", async ({ page }) => {
  const bodies = await answerReports(page, 201, "受け取りました。");
  await page.goto(SHOP);
  const closed = page.getByRole("button", { name: "閉店している" });
  await closed.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "やめる" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/として送りますか/)).toBeHidden();
  await expect(closed).toBeFocused();
  await expect(closed).not.toHaveAttribute("aria-pressed");
  await page.waitForTimeout(500);
  expect(bodies).toEqual([]);
});

test("確かめている間に別の種類を押すと、問いがその種類に替わる", async ({ page }) => {
  const bodies = await answerReports(page, 201, "受け取りました。");
  await page.goto(SHOP);
  await page.getByRole("button", { name: "閉店している" }).click();
  await page.getByRole("button", { name: "場所が違う" }).click();
  await expect(page.getByText("「場所が違う」として送りますか？")).toBeVisible();
  await expect(page.getByRole("button", { name: "閉店している" })).not.toHaveAttribute(
    "aria-pressed",
  );
  await page.getByRole("button", { name: "送る", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("受け取りました。");
  expect(bodies).toEqual([{ kind: "wrong-location", shopId: "way/884336378" }]);
});

test("「送る」を押したら送り終わるまでどのボタンも押せず、2 度押しても 1 件だけ送る", async ({
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
  const send = page.getByRole("button", { name: "送る", exact: true });
  await send.click();
  for (const name of ["閉店している", "家系ではない", "場所が違う"])
    await expect(page.getByRole("button", { name })).toBeDisabled();
  await closed.click({ force: true });
  // 隠れた「送る」は役割では引けないので、要素を直に押す（連打で 2 件目が出ないこと）。
  await page.locator("[data-confirm]").dispatchEvent("click");
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
  await page.getByRole("button", { name: "送る", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "短時間に報告が集中しています。1分後にお試しください",
  );
  await expect(page.getByRole("button", { name: "場所が違う" })).toBeEnabled();
  await expect(page.getByText(/として送りますか/)).toBeHidden();
  expect(bodies).toEqual([{ kind: "wrong-location", shopId: "way/884336378" }]);
});

test("「注文のしかたを見る」で頼み方のページが開く（#342）", async ({ page }) => {
  await page.goto(SHOP);
  await page.getByRole("link", { name: /注文のしかたを見る/ }).click();
  await expect(page).toHaveURL(/\/guide\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("家系ラーメンの頼み方");
  await expect(page.getByText(/お店の掲示に従ってください/)).toBeVisible();
});
