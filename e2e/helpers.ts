/**
 * basic-host を操作するための共通処理。
 *
 * アプリはサンドボックス iframe の中で動くので、操作対象は
 * ネストした frameLocator になる。ここでその出入りを吸収する。
 */
import { expect, type FrameLocator, type Page } from "@playwright/test";

/** ホストの tool 呼び出しフォームから tool を実行し、アプリの frame を返す。 */
export async function callTool(
  page: Page,
  name: string,
  args: Record<string, unknown> = {},
): Promise<FrameLocator> {
  await page.goto("/");
  await page.locator("select").nth(1).selectOption(name);
  await page.locator("textarea").fill(JSON.stringify(args));
  await page.getByRole("button", { name: "Call Tool" }).click();
  return appFrame(page);
}

/** サンドボックス内のアプリ frame。描画が終わるまで待つ。 */
export function appFrame(page: Page): FrameLocator {
  return page.frameLocator("iframe").first().frameLocator("iframe").first();
}

/** アプリの読み込み完了（タブが出るまで）を待つ。 */
export async function waitForApp(app: FrameLocator) {
  await expect(app.getByRole("tab", { name: "検索フォーム" })).toBeVisible();
}

/** 店舗カードのロケータ。 */
export function shopCards(app: FrameLocator) {
  return app.locator("ul > li > button");
}
