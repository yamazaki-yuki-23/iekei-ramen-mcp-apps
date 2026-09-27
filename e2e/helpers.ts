/**
 * basic-host を操作するための共通処理。
 *
 * アプリはサンドボックス iframe の中で動くので、操作対象は
 * ネストした frameLocator になる。ここでその出入りを吸収する。
 */
import { expect, type FrameLocator, type Locator, type Page } from "@playwright/test";

/** E2E が使う MCP サーバーの名乗り。playwright.config が環境変数で渡している。 */
const E2E_SERVER_NAME = "Iekei Ramen Finder (E2E)";

/**
 * E2E が使う MCP サーバーを選ぶ。
 *
 * **ホストは手元のプレビューと共用する。** サンドボックスの origin が 8081 に
 * 焼き込まれていて basic-host は同時に 1 つしか動かせないので、E2E のたびに
 * 立て直すとユーザーが見ている画面が数分消える。代わりに 1 つのホストへ
 * プレビュー用と E2E 用を両方登録し、ここで選び分ける。
 *
 * **名前で選ぶこと。** 並び順（最後を取る）や option の数で選ぶと、切り替えが
 * 反映される前に次の操作へ進んだときに古いサーバーのまま tool を呼んでしまい、
 * 古いビルドを検証して通る——という偽の合格が起きる（実際に踏んだ）。
 * 名前で選べば、選べた時点で切り替わったことが確定する。
 */
async function selectTestServer(page: Page) {
  const servers = page.locator("select").first();
  await servers.selectOption({ label: E2E_SERVER_NAME });
  await expect(servers).toHaveValue(/\d+/);
}

/** ホストの tool 呼び出しフォームから tool を実行し、アプリの frame を返す。 */
export async function callTool(
  page: Page,
  name: string,
  args: Record<string, unknown> = {},
): Promise<FrameLocator> {
  await page.goto("/");
  await selectTestServer(page);
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

/**
 * カードから店名だけを取り出す。
 * カード直下の span は住所やバッジも含むまとまりなので、入れ子の span を見る。
 */
export function shopName(card: Locator): Promise<string> {
  return card.locator("span span").first().innerText();
}

/**
 * 地図に出ている店の数。
 *
 * 重なる店は塊にまとまるので、ピンの数は店の数と一致しない。単独のピンと、
 * 塊に書かれた件数を足す。**この合計が結果の件数と一致する**のが、塊が
 * 取りこぼしていないことの証拠になる。
 */
export async function plottedShops(app: FrameLocator): Promise<number> {
  /*
   * **重なりレイヤーの中だけを数える。** 地図全体から svg path を拾うと、
   * 出典表示に入っている旗（3 枚）まで数えて 3 件多くなる。
   */
  const singles = await app.locator(".leaflet-overlay-pane path").count();
  const groups = await app.locator(".cluster-pin").allTextContents();
  return singles + groups.reduce((sum, text) => sum + Number(text), 0);
}
