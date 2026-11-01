import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";

/*
 * トップのロゴにホバーすると、箸だけが 2px 上がり、離すと戻る（#328）。
 * 丼は動かさない。マウスの無い画面と、動きを減らす設定では動かさない。
 */
const TOP = "http://localhost:3134/";

async function tops(page: Page) {
  const mark = page.locator("[data-chopsticks]").first();
  const bowl = mark.locator("xpath=following-sibling::*[local-name()='path']");
  const y = async (l: typeof mark) => (await l.boundingBox())!.y;
  return { sticks: await y(mark), bowl: await y(bowl) };
}

async function hoverLogo(page: Page) {
  const before = await tops(page);
  await page
    .locator("[data-chopsticks]")
    .first()
    .locator("xpath=ancestor::*[local-name()='svg']")
    .hover();
  await page.waitForTimeout(400);
  const hovered = await tops(page);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  return { before, hovered, after: await tops(page) };
}

test("パソコン幅でロゴにホバーすると箸だけが 2px 上がり、離すと戻る", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(TOP);
  await expect(page.locator("[data-chopsticks]").first()).toBeVisible();
  const { before, hovered, after } = await hoverLogo(page);
  expect(before.sticks - hovered.sticks).toBeCloseTo(2, 0);
  expect(hovered.bowl).toBe(before.bowl);
  expect(after).toEqual(before);
});

test("動きを減らす設定では、ホバーしても箸は動かない", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(TOP);
  await expect(page.locator("[data-chopsticks]").first()).toBeVisible();
  const { before, hovered } = await hoverLogo(page);
  expect(hovered).toEqual(before);
});

test.describe("タッチの画面", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("ロゴをタップしても箸は動かない", async ({ page }) => {
    await page.goto(TOP);
    const mark = page.locator("[data-chopsticks]").first();
    await expect(mark).toBeVisible();
    const before = await tops(page);
    await mark.locator("xpath=ancestor::*[local-name()='svg']").tap();
    await page.waitForTimeout(400);
    expect(await tops(page)).toEqual(before);
  });
});
