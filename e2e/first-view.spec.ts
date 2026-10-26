import { expect } from "@playwright/test";
import { test } from "./fixtures";

/*
 * 作られた画面によくある飾りを外し、トップの一言を家系の店先の看板にする（#301）。
 */
const TOP = "http://localhost:3134/";

test("トップの一言は看板の書体で、1 語だけ色を変えず、書体は自分のところから読む", async ({
  page,
}) => {
  const fonts: string[] = [];
  page.on("request", (req) => {
    if (req.resourceType() === "font") fonts.push(req.url());
  });
  await page.goto(TOP);
  const catchLine = page.locator("#promise");
  await expect(catchLine).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.fonts.check('30px "Iekei Kanban"', "家系")))
    .toBe(true);
  // 起動の途中で一言が描き直されることがあるので、落ち着くまで読み直す。
  await expect
    .poll(() =>
      catchLine.evaluate((el) => {
        const own = getComputedStyle(el);
        return {
          font: own.fontFamily.includes("Iekei Kanban"),
          sameColor: getComputedStyle(el.querySelector("em")!).color === own.color,
        };
      }),
    )
    .toEqual({ font: true, sameColor: true });
  expect(fonts.length).toBeGreaterThan(0);
  for (const url of fonts) expect(new URL(url).origin).toBe("http://localhost:3134");
});

for (const [width, height] of [
  [390, 844],
  [375, 812],
  [360, 800],
] as const)
  test(`${width}×${height} でも、看板の下の食券 3 枚がタブバーより上に収まる`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(TOP);
    const tickets = page.locator("button[data-shop-id]");
    await expect(tickets).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready);
    // 食券は取り出し口から出てくる動きがあるので、動き終わって落ち着いた位置で比べる。
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== "running"),
    );
    const gap = () =>
      page.evaluate(() => {
        const bar = document.querySelector("nav[data-tabbar]")!.getBoundingClientRect().top;
        const third = document.querySelectorAll("button[data-shop-id]")[2].getBoundingClientRect();
        return bar - third.bottom;
      });
    await expect.poll(gap).toBeGreaterThanOrEqual(0);
  });

test("「近い順」の札は、「全国 ◯ 軒中、近い順に…」の行と一緒には出さない", async ({ page }) => {
  await page.goto(TOP);
  await expect(page.locator("button[data-shop-id]")).toHaveCount(3);
  const round = page.getByText(/軒中、.+に \d/);
  await expect(round).toBeVisible();
  const basis = (await round.innerText()).match(/軒中、(.+?)に \d/)![1];
  await expect(page.getByText(basis, { exact: true })).toHaveCount(0);
});

test("家系マッチのゲージは単色（グラデーションの飾りを付けない）", async ({ page }) => {
  await page.goto("http://localhost:3134/match/");
  const bar = page
    .getByRole("progressbar", { name: /のゲージ/ })
    .locator("*")
    .first();
  await expect(bar).toBeAttached();
  expect(await bar.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe("none");
});
