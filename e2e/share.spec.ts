import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";

/*
 * 「迷ったら」の 3 軒を URL で共有し、別の端末で開くと同じ 3 軒が出る（#344）。
 * URL は店の ID だけを持ち、座標・現在地を入れない。
 */
const WEB_URL = "http://localhost:3134";

const ticketIds = (page: Page) =>
  page.locator("button[data-shop-id]").evaluateAll((els) => els.map((el) => el.dataset.shopId));

test("共有シートで送った URL を別の端末で開くと、同じ 3 軒が出る", async ({ page, browser }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      value: async (data: ShareData) => {
        (window as unknown as { shared: ShareData }).shared = data;
      },
    });
  });
  await page.goto(WEB_URL);
  await expect(page.locator("main")).toHaveAttribute("data-pending-calls", "0");
  await expect(page.locator('button[data-shop-id^="skeleton"]')).toHaveCount(0);
  const ids = await ticketIds(page);
  expect(ids).toHaveLength(3);
  await page.getByRole("button", { name: "この 3 軒をシェア" }).click();
  const url = await page.evaluate(() => (window as unknown as { shared: ShareData }).shared.url!);

  expect(new URL(url).search).toMatch(/^\?three=[^&]+$/);
  // 座標・現在地を入れない（共有した人の居場所が分かる）。
  expect(url).not.toMatch(/lat|lon|near|\d+\.\d+/);

  const other = await browser.newContext();
  const friend = await other.newPage();
  await friend.goto(url.replace(new URL(url).origin, WEB_URL));
  await expect(friend.getByRole("heading", { name: "シェアされた 3 軒" })).toBeVisible();
  await expect.poll(() => ticketIds(friend)).toEqual(ids);
  // 開いた人の画面に、共有した人からの距離は出さない。
  await expect(friend.locator("button[data-shop-id]").first()).not.toContainText(
    /\d+(?:\.\d+)?\s?k?m/,
  );

  await friend.getByRole("link", { name: "自分の近くの 3 軒を出す" }).click();
  await expect(friend).toHaveURL(`${WEB_URL}/`);
  await expect(friend.getByRole("heading", { name: /^迷ったらこの 3 軒/ })).toBeVisible();
  await other.close();
});

test("共有シートが無ければ URL をコピーする", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined });
  });
  await page.goto(WEB_URL);
  await expect(page.locator("button[data-shop-id]")).toHaveCount(3);
  await page.getByRole("button", { name: "この 3 軒をシェア" }).click();
  await expect(page.getByRole("status").filter({ hasText: "URL をコピーしました" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/\?three=/);
});

test("知らない ID・壊れた値の共有 URL は、通常の入口になる", async ({ page }) => {
  await page.goto(`${WEB_URL}/?three=node-1,node-2,node-3,node-4`);
  await expect(page.getByRole("heading", { name: /^迷ったらこの 3 軒/ })).toBeVisible();
  await page.goto(`${WEB_URL}/?three=node-1`);
  await expect(page.getByRole("heading", { name: /^迷ったらこの 3 軒/ })).toBeVisible();
});
