import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { CONFIDENCE } from "../src/lib/types";
import { TASTE_REFERENCE_NOTE, TASTE_UNKNOWN_NOTE } from "../src/lib/data-caveats";
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
  test(`${theme} の画面でも母集団の可能性と参考値の説明を表示する`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 1000 });
    await page.emulateMedia({ colorScheme: theme });
    const app = await callTool(page, "decide-iekei-ramen", { keyword: "横濱家" });
    await waitForApp(app);
    await expect(app.getByText(/家系の可能性.*軒を/)).toBeVisible();
    const note = app.getByText(TASTE_REFERENCE_NOTE, { exact: false });
    await expect(note).toContainText(CONFIDENCE.likely.description);
    await expect(note).toContainText(CONFIDENCE.candidate.description);
    await expect(note).toContainText(TASTE_UNKNOWN_NOTE);
    expect(await app.locator("body").evaluate((body) => body.scrollWidth - body.clientWidth)).toBe(
      0,
    );
    await app.locator("body").screenshot({ path: `/tmp/iekei-76-caveats-${theme}.png` });
    await note.scrollIntoViewIfNeeded();
    await note.screenshot({ path: `/tmp/iekei-76-caveats-${theme}-note.png` });
  });
}
