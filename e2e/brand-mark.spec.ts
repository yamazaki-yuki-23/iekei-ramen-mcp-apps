import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";

/*
 * トップのロゴにホバーすると、箸だけが 2px 上がり、離すと戻る（#328）。
 * 丼は動かさない。マウスの無い画面と、動きを減らす設定では動かさない。
 */
const TOP = "http://localhost:3134/";

/** 最初の結果が届くと見出しの行ごと作り直されるので、届き終わってから測る。 */
async function open(page: Page) {
  await page.goto(TOP);
  await expect(page.locator("main")).toHaveAttribute("data-pending-calls", "0");
  await expect(page.locator('button[data-shop-id^="skeleton"]')).toHaveCount(0);
  await expect(page.locator("[data-chopsticks]").first()).toBeVisible();
}

/*
 * 位置はロゴの中での差で測る。ページの読み込み中に結果が入ってヘッダーごと動くので、画面の上からの
 * 位置で比べると、ホバーと関係なく食い違った（#344 の CI で 15 回中 7 回落ちた）。
 * lift = 丼の上端から箸の上端まで / bowl = ロゴの上端から丼の上端まで。
 */
async function tops(page: Page) {
  const mark = page.locator("[data-chopsticks]").first();
  const bowl = mark.locator("xpath=following-sibling::*[local-name()='path']");
  const svg = mark.locator("xpath=ancestor::*[local-name()='svg']");
  const y = async (l: typeof mark) => (await l.boundingBox())!.y;
  const [sticks, top, logo] = [await y(mark), await y(bowl), await y(svg)];
  return { lift: Math.round((top - sticks) * 10) / 10, bowl: Math.round((top - logo) * 10) / 10 };
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
  await open(page);
  const { before, hovered, after } = await hoverLogo(page);
  expect(hovered.lift - before.lift).toBeCloseTo(2, 0);
  expect(hovered.bowl).toBe(before.bowl);
  expect(after).toEqual(before);
});

test("動きを減らす設定では、ホバーしても箸は動かない", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  const { before, hovered } = await hoverLogo(page);
  expect(hovered).toEqual(before);
});

test.describe("タッチの画面", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("ロゴをタップしても箸は動かない", async ({ page }) => {
    await open(page);
    const mark = page.locator("[data-chopsticks]").first();
    const before = await tops(page);
    await mark.locator("xpath=ancestor::*[local-name()='svg']").tap();
    await page.waitForTimeout(400);
    expect(await tops(page)).toEqual(before);
  });
});
