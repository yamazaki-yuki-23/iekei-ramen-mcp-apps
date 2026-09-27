/**
 * basic-host を操作するための共通処理。
 *
 * アプリはサンドボックス iframe の中で動くので、操作対象は
 * ネストした frameLocator になる。ここでその出入りを吸収する。
 */
import { expect, type FrameLocator, type Locator, type Page } from "@playwright/test";

/** E2E が使う MCP サーバーの名乗り。playwright.config が環境変数で渡している。 */
const E2E_SERVER_NAME = "Iekei Ramen Finder (E2E)";
/** その MCP エンドポイント。応答を遅らせる試験で経路を捕まえるのに使う。 */
export const E2E_SERVER_URL = "http://localhost:3131/mcp";
/** 偽のサインイン済み利用者で動いている方。会員機能の画面はこちらでしか出ない。 */
export const MEMBER_SERVER_NAME = "Iekei Ramen Finder (E2E signed-in)";
/** そのサーバーの MCP エンドポイント。応答を遅らせる試験で経路を捕まえるのに使う。 */
export const MEMBER_SERVER_URL = "http://localhost:3132/mcp";

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
async function selectTestServer(page: Page, name = E2E_SERVER_NAME) {
  const servers = page.locator("select").first();
  await servers.selectOption({ label: name });
  await expect(servers).toHaveValue(/\d+/);
}

/** ホストの tool 呼び出しフォームから tool を実行し、アプリの frame を返す。 */
export async function callTool(
  page: Page,
  name: string,
  args: Record<string, unknown> = {},
  /** どのサーバーで呼ぶか。会員機能は MEMBER_SERVER_NAME を指す。 */
  server?: string,
): Promise<FrameLocator> {
  await page.goto("/");
  await selectTestServer(page, server);
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
 *
 * **要素を名指しする。** 「入れ子の span の最初」で拾っていたが、同名の店を
 * 見分けるための地名を隣に足したときに、そこまで一緒に読んでしまった
 * （同名が「町田商店 新宿区」と「町田商店 町田市」になり、別名に見えた）。
 */
export function shopName(card: Locator): Promise<string> {
  return card.locator("[data-shop-name]").first().innerText();
}

/** カードの「どこの店か」（同名が並ぶときだけ付く）。 */
export function shopWhere(card: Locator): Locator {
  return card.locator("[data-shop-where]");
}

/**
 * 住所の行に出ている欄を、欄ごとに取り出す。
 *
 * **文字列を目で突き合わせない。** 住所に市名が入っている店
 * （「横浜市」と「横浜市磯子区上中里町669-1」）や、欄の中に空白がある店があり、
 * 部分一致では正しい表示を「重複」と誤判定する（Codex の指摘で 3 度踏んだ）。
 */
export async function shopMetaFields(card: Locator): Promise<string[]> {
  const raw = (await card.locator("[data-shop-meta]").getAttribute("data-shop-meta-parts")) ?? "";
  return raw ? raw.split("\u0000") : [];
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
