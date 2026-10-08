import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { CONFIDENCE, TASTES } from "../src/lib/types";
import {
  DATA_CREDIT,
  DATA_FOOTNOTE,
  TASTE_REFERENCE_NOTE,
  resultCaveat,
} from "../src/lib/data-caveats";
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
    // 判定の段階は画面に書かない（#144。モデルにだけ渡す）。長い根拠の文も出さない（#152）。
    await expect(app.getByText(/家系の可能性/)).toHaveCount(0);
    await expect(app.getByText(/軒を.*に並べた/)).toHaveCount(0);
    // 但し書きは結果のすぐ下に 1 回。会話の中は Web 版の報告へ案内する（#152）。
    await expect(app.getByText(resultCaveat(false), { exact: true })).toHaveCount(1);
    await expect(app.getByText(/推定/).filter({ visible: true })).toHaveCount(1);
    // 出典は見せ、説明は「データについて」に畳む。
    await expect(app.getByText(DATA_CREDIT)).toBeVisible();
    await expect(app.getByText(DATA_FOOTNOTE)).toBeHidden();
    await app.getByText("データについて", { exact: true }).click();
    const note = app.locator("details").filter({ hasText: "データについて" });
    await expect(note).toContainText(DATA_FOOTNOTE);
    await expect(note).toContainText(TASTE_REFERENCE_NOTE);
    // 参考値の但し書きは畳んだ中でも 1 回（#152）。
    expect((await note.innerText()).split(TASTE_REFERENCE_NOTE).length - 1).toBe(1);
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
  await expect(app.getByText("キーワード「横濱家」")).toBeVisible();
  await expect(app.getByRole("button", { name: "このキーワードを外す" })).toBeVisible();
});
