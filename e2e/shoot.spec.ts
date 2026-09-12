import { expect, test } from "@playwright/test";
test("全スライドを撮る", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("http://localhost:8765/iekei-deck.html");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  const slides = page.locator(".slide");
  const n = await slides.count();
  for (let i = 0; i < n; i++) {
    await slides.nth(i).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await slides.nth(i).screenshot({ path: `shots/slide-${String(i + 1).padStart(2, "0")}.png` });
  }
  expect(n).toBe(22);
});
