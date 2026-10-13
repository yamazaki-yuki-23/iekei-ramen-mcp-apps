import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";

/*
 * 移るときの動き（#212、見本）。動きそのものは目で見るので、ここでは「動かす・動かさない」の
 * 切り分けと、対応していないブラウザで壊れないことを見る。
 */
const TOP = "http://localhost:3134/";

/** 次のページが表示されたときに、ページをまたぐ動きが付いたかを覚える。 */
async function recordReveal(page: Page) {
  await page.addInitScript(() => {
    addEventListener("pagereveal", (e) => {
      sessionStorage.setItem("vt", String(Boolean((e as PageRevealEvent).viewTransition)));
    });
  });
}

/** 画面の中の切り替えで、startViewTransition が呼ばれた回数を数える。 */
async function countInPage(page: Page) {
  await page.addInitScript(() => {
    const start = document.startViewTransition?.bind(document);
    if (!start) return;
    Object.assign(window, { vtCalls: 0 });
    document.startViewTransition = ((update: ViewTransitionUpdateCallback) => {
      (window as unknown as { vtCalls: number }).vtCalls++;
      return start(update);
    }) as typeof document.startViewTransition;
  });
}
const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { vtCalls?: number }).vtCalls ?? 0);

/** いまの画面で、ページをまたぐ動き（@view-transition { navigation: auto }）が効いているか。 */
const crossDocumentOn = (page: Page) =>
  page.evaluate(() => {
    const queue: CSSRule[] = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]);
    for (const rule of queue) {
      if ("navigation" in rule && (rule as unknown as { navigation: string }).navigation === "auto")
        return true;
      if (rule instanceof CSSMediaRule && matchMedia(rule.conditionText).matches)
        queue.push(...rule.cssRules);
    }
    return false;
  });

test("スマホ幅のタブバーで移る先のページで、ページをまたぐ動きが効いている（#212）", async ({
  page,
}) => {
  // 動きそのものは、重いときにブラウザが飛ばすことがある（実測: 全体の e2e で 2 回）。決まりが効いているかで見る。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(TOP);
  expect(await crossDocumentOn(page)).toBe(true);
  await page.getByRole("navigation", { name: "機能" }).getByRole("link", { name: "診断" }).click();
  await expect(page).toHaveURL(/\/shindan\/$/);
  expect(await crossDocumentOn(page)).toBe(true);
});

test("動きを減らす設定では、ページの移動も画面の中の切り替えも動かさない（#212）", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await recordReveal(page);
  await countInPage(page);
  await page.goto(TOP);
  await page
    .getByRole("navigation", { name: "探し方" })
    .getByRole("button", { name: "店名で" })
    .click();
  await expect(
    page.getByRole("navigation", { name: "探し方" }).getByRole("button", { name: "店名で" }),
  ).toHaveAttribute("aria-current", "page");
  expect(await calls(page)).toBe(0);
  await page.getByRole("navigation", { name: "機能" }).getByRole("link", { name: "診断" }).click();
  await expect(page).toHaveURL(/\/shindan\/$/);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("vt"))).toBe("false");
});

test("店の詳細を開くときだけ画面の中で短く動かし、探し方の切り替えでは動かさない（#212）", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await countInPage(page);
  await page.goto(TOP);
  const modes = page.getByRole("navigation", { name: "探し方" });
  await modes.getByRole("button", { name: "店名で" }).click();
  await expect(modes.getByRole("button", { name: "店名で" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await modes.getByRole("button", { name: "迷ったら" }).click();
  const ticket = page.locator("button[data-shop-id]").first();
  await ticket.click();
  await expect(page.getByRole("region", { name: "選択中の店舗" })).toBeVisible();
  // ヘッダーのナビ（探し方）は動かさない（オーナー判断）。動くのは店の詳細を開いたときだけ。
  expect(await calls(page)).toBe(1);
  // 動きが済んだら、カードに付けた一時の名前は外す（次の切り替えで名前が重ならない）。
  await expect
    .poll(() => ticket.evaluate((el) => (el as HTMLElement).style.viewTransitionName))
    .toBe("");
});

test("View Transitions に対応していないブラウザでも、今までどおり切り替わる（#212）", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "startViewTransition", { value: undefined });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(TOP);
  const modes = page.getByRole("navigation", { name: "探し方" });
  await modes.getByRole("button", { name: "店名で" }).click();
  await expect(modes.getByRole("button", { name: "店名で" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await modes.getByRole("button", { name: "迷ったら" }).click();
  await page.locator("button[data-shop-id]").first().click();
  await expect(page.getByRole("region", { name: "選択中の店舗" })).toBeVisible();
});
