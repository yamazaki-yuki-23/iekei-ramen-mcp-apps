import { expect } from "@playwright/test";
import { test } from "./fixtures";

/*
 * 県のページの店の一覧を市区町村で区切る（#317）。上のチップでページの中の見出しへ移り、
 * ブラウザの「戻る」でチップの所へ戻れる。
 */
test("市区町村のチップで見出しへ移り、「戻る」でチップへ戻れる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:3134/area/kanagawa/");
  const chips = page.locator(".seo-chips");
  const top = await page.evaluate(() => window.scrollY);

  const chip = chips.getByRole("link").nth(2);
  const target = (await chip.getAttribute("href"))!;
  await chip.click();
  await expect(page).toHaveURL(new RegExp(`${target}$`));
  const heading = page.locator(`${target} h3`);
  await expect(heading).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(top);

  await page.goBack();
  await expect(page).toHaveURL(/\/area\/kanagawa\/$/);
  await expect(chip).toBeInViewport();
});
