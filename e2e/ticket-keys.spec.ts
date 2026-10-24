/**
 * 券売機の「都道府県」のキー（#256）。ランプ（選択の丸印）を見出し「都道府県」の 1 行目にそろえ、
 * 選択欄はその下に、ランプの左端からキーの幅いっぱいに置く。キーの高さは変えない。
 */
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";

const WEB = "http://localhost:3134";

/** 見出しの文字の 1 行目の中心と、ランプ（見出しの ::before）の中心・左端。 */
const measure = (page: Page) =>
  page.evaluate(() => {
    const label = document.querySelector("#pref")!.closest("label")!;
    const heading = label.querySelector("span")!;
    const range = document.createRange();
    range.selectNodeContents(heading.firstChild!);
    const line = range.getClientRects()[0];
    const lamp = getComputedStyle(heading, "::before");
    const box = heading.getBoundingClientRect();
    const select = document.querySelector("#pref")!.getBoundingClientRect();
    return {
      lineCenter: line.top + line.height / 2,
      lampCenter: box.top + box.height / 2,
      lampShown: lamp.content !== "none" && parseFloat(lamp.width) > 0,
      lampLeft: box.left,
      selectLeft: select.left,
      selectHeight: select.height,
      keyHeight: label.getBoundingClientRect().height,
      keyLampOnKey: getComputedStyle(label, "::before").display,
      // 文字の左端を、ほかのキー（全国）の文字の左端と比べる。
      textLeft: line.left - label.getBoundingClientRect().left,
      otherTextLeft: (() => {
        const other = [...document.querySelectorAll("button[aria-pressed]")].find((b) =>
          b.textContent!.startsWith("全国"),
        )!;
        const r = document.createRange();
        r.selectNodeContents(other.firstChild!);
        return r.getClientRects()[0].left - other.getBoundingClientRect().left;
      })(),
    };
  });

for (const width of [390, 1280]) {
  test(`${width}px: 都道府県のキーのランプは見出しの 1 行目にそろい、選択欄はランプの左端から始まる`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(WEB);
    await expect(page.locator("main[data-pending-calls]").first()).toHaveAttribute(
      "data-pending-calls",
      "0",
    );
    for (const choose of [undefined, "福島県"]) {
      if (choose) await page.locator("#pref").selectOption(choose);
      const m = await measure(page);
      expect(m.lampShown).toBe(true);
      expect(m.keyLampOnKey).toBe("none");
      expect(Math.abs(m.lampCenter - m.lineCenter)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.selectLeft - m.lampLeft)).toBeLessThanOrEqual(1);
      expect(m.selectHeight).toBeGreaterThanOrEqual(44);
      expect(Math.abs(m.textLeft - m.otherTextLeft)).toBeLessThanOrEqual(1);
    }
  });
}
