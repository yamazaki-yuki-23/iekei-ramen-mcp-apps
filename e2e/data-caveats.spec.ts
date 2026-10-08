import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { CONFIDENCE, TASTES } from "../src/lib/types";
import { DATA_FOOTNOTE, TASTE_REFERENCE_NOTE, misjudgeNote } from "../src/lib/data-caveats";
import { callTool, waitForApp } from "./helpers";

test("今回の 3 軒が確定店だけでも、UI から母集団の可能性の注意書きをモデルへ送る", async ({
  page,
}) => {
  const app = await callTool(page, "decide-iekei-ramen");
  await waitForApp(app);
  await app.getByRole("button", { name: "この 3 軒から選ぶ" }).click();
  await page.getByText(/💬 Messages/).click();
  const sent = page.locator("pre").filter({ hasText: "[user]" });
  await expect(sent).toContainText(CONFIDENCE.likely.description);
  await expect(sent).toContainText("断定しないでください");
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} の画面でも但し書きと参考値の説明を表示する`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 1000 });
    await page.emulateMedia({ colorScheme: theme });
    const app = await callTool(page, "decide-iekei-ramen", { keyword: "横濱家" });
    await waitForApp(app);
    // 並べた根拠は出すが、判定の段階は画面に書かない（#144。モデルにだけ渡す）。
    await expect(app.getByText(/軒を.*に並べた/)).toBeVisible();
    await expect(app.getByText(/家系の可能性/)).toHaveCount(0);
    // 常に出す注記は短く、推定と直線距離だけは必ず残す。
    await expect(app.getByText(DATA_FOOTNOTE)).toBeVisible();
    // 判定の段階は出さず、誤りの可能性を 1 文で伝える（#144）。
    await expect(app.getByText(misjudgeNote(false))).toBeVisible();
    // 会話の中には報告の口が無いので、Web 版の報告へ案内する（誤りを直す道を残す）。
    await expect(
      app.getByText(/Web 版（iekeiramen\.com）で店を開き「店舗情報を報告する」/),
    ).toBeVisible();
    await app.getByText("味の傾向について", { exact: true }).click();
    const note = app.locator("details").filter({ hasText: "味の傾向について" });
    await expect(note).toContainText(TASTE_REFERENCE_NOTE);
    await expect(note).toContainText(TASTES.unknown.description);
    expect(await app.locator("body").evaluate((body) => body.scrollWidth - body.clientWidth)).toBe(
      0,
    );
    await app.locator("body").screenshot({ path: `/tmp/iekei-76-caveats-${theme}.png` });
    await note.scrollIntoViewIfNeeded();
    await note.screenshot({ path: `/tmp/iekei-76-caveats-${theme}-note.png` });
  });
}

test("キーワード付きで開いた「迷ったら」は、発券してもキーワードを外さない（#144）", async ({
  page,
}) => {
  const app = await callTool(page, "decide-iekei-ramen", { keyword: "横濱家" });
  await waitForApp(app);
  await expect(app.getByRole("button", { name: "このキーワードを外す" })).toBeVisible();
  await app.getByRole("button", { name: /^発券する/ }).click();
  await expect(app.locator("main")).toHaveAttribute("data-pending-calls", "0");
  await expect(app.getByText(/「横濱家」に合う/)).toBeVisible();
  await expect(app.getByRole("button", { name: "このキーワードを外す" })).toBeVisible();
});
