import { expect } from "@playwright/test";
import { test } from "./fixtures";

/*
 * 店の詳細の開け閉め（#212）。動きは詳細が薄く現れることだけ。ページをまたぐ動きは入れない
 * （オーナー判断: 家系マッチ・家系カメラへ移ったあとの表示が遅く感じられた）。
 */
const TOP = "http://localhost:3134/";

test("ページをまたぐ動き（@view-transition）は、どのページにも入れない（#212）", async ({
  page,
}) => {
  for (const path of ["/", "/match/", "/camera/", "/area/"]) {
    await page.goto(`http://localhost:3134${path}`);
    const crossDocument = await page.evaluate(() => {
      const queue: CSSRule[] = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]);
      for (const rule of queue) {
        if ("navigation" in rule) return true;
        if (rule instanceof CSSMediaRule) queue.push(...rule.cssRules);
      }
      return false;
    });
    expect(crossDocument, path).toBe(false);
  }
});

test("店の詳細は、開くと焦点が移って開閉が読み上げで分かり、Esc で閉じると元の札へ戻る（#212）", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(TOP);
  const ticket = page.locator("button[data-shop-id]").first();
  await expect(ticket).toHaveAttribute("aria-expanded", "false");
  await ticket.click();
  const detail = page.getByRole("region", { name: "選択中の店舗" });
  await expect(detail).toBeFocused();
  await expect(ticket).toHaveAttribute("aria-expanded", "true");
  await expect(ticket).toHaveAttribute("aria-controls", (await detail.getAttribute("id"))!);
  // 動くのは opacity だけ（DESIGN.md 7. 動き）。
  expect(await detail.evaluate((el) => getComputedStyle(el).transitionProperty)).toBe("opacity");
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(ticket).toBeFocused();
  await expect(ticket).toHaveAttribute("aria-expanded", "false");
});

test("「閉じる」で閉じても、焦点は元の札へ戻る（#212・#330）", async ({ page }) => {
  await page.goto(TOP);
  const ticket = page.locator("button[data-shop-id]").first();
  await ticket.click();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(page.getByRole("region", { name: "選択中の店舗" })).toHaveCount(0);
  await expect(ticket).toBeFocused();
});

test("動きを減らす設定では、店の詳細は動かずに出る（#212）", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(TOP);
  await page.locator("button[data-shop-id]").first().click();
  const duration = await page
    .getByRole("region", { name: "選択中の店舗" })
    .evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
  expect(duration).toBeLessThan(0.001);
});
