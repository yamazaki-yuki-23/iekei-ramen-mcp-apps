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
  /*
   * **地図で開いたときは、最初の寄せ直しが終わるまでを「準備できた」とする。**
   * 開いた直後に結果の全体へ寄せ直すアニメーションが走り、その途中で塊を押すと、
   * 押した寄せが後から上書きされる（実測: CI で 4 worker を同時に動かすと、
   * 塊を押しても開いた直後の画角のまま範囲を読み、4 本が落ちた）。
   */
  if ((await app.getByRole("tab", { name: "地図から探す", selected: true }).count()) > 0) {
    await expect(app.locator(".leaflet-map-pane")).toBeAttached();
    await waitForMapSettled(app);
  }
}

/**
 * 押すと確かに寄る塊。いちばん小さい塊を返す。
 *
 * **先頭の塊を押せば寄る、とは限らない。** 全国を見ているときの先頭は
 * 日本のほぼ全体を含む塊（実測 492 件）で、中身がすでに画面いっぱいなので
 * 押しても寄らない。以前は通っていたが、地図が描き直す前の一瞬だけ先頭が
 * 小さい塊になっていて、そこを押せていただけだった。
 */
export async function smallestCluster(app: FrameLocator): Promise<{ pin: Locator; size: number }> {
  const pins = app.locator(".cluster-pin");
  const sizes = (await pins.allTextContents()).map(Number);
  if (sizes.length === 0) throw new Error("塊が 1 つも無い");
  const size = Math.min(...sizes);
  return { pin: pins.nth(sizes.indexOf(size)), size };
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

/**
 * カードが指している店の id。
 *
 * **同じ店かどうかは id で見る。** 店名はチェーンの別店舗どうしで重なるので、
 * 名前で突き合わせると別の店を同じ店と数える。
 */
export async function shopId(card: Locator): Promise<string> {
  const id = await card.getAttribute("data-shop-id");
  if (!id) throw new Error("カードが data-shop-id を持っていない");
  return id;
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

/**
 * 遅れて届いた応答が、アプリの画面に反映されるまで待つ。
 *
 * **「何も起きないこと」を確かめるときに使う。** 届いた合図を待ったあと、
 * アプリの返ってきていない呼び出しが 0 になるのを待つ（`data-pending-calls`）。
 * 数は反映と同じ描画で減るので、0 の画面には、その応答で起きることが
 * （引き戻されるなら、それも）すべて出ている。
 *
 * **時間で待たない。** 届いてから一定時間だけ待つ形では、ホストからアプリへの
 * 受け渡しや描画がそれより長くかかったとき（混んだ CI）、反映される前に
 * 確かめて何も見ずに通る。
 */
export async function afterDelivered(app: FrameLocator, delivered: Promise<unknown>) {
  await delivered;
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "0");
}

/**
 * 地図のズームと慣性が止まり、描き直しまで済むのを待つ。
 *
 * **時間で待たない。** 遅い CI ではアニメーションが延び、固定の待ちが先に切れる。
 * Leaflet は動いている間だけ地図の面に `leaflet-zoom-anim` / `leaflet-pan-anim`
 * を付け、ズームの途中の縮尺を `.leaflet-proxy` の transform に持つ。
 *
 * **「動いていない」を一瞬見ただけで抜けない。** 押した直後や開いた直後は、
 * Leaflet がまだ動き出していない（次の描画の頭で動き出す）。そこで見ると、
 * 動き出す前の静けさに一致して待たずに抜ける。動いていない状態が 5 描画かつ
 * 100ms 続いたら止まったと見なす。止まった後に、zoomend を受けたアプリが塊を
 * 描き直す分もこの間に済む。
 */
export async function waitForMapSettled(app: FrameLocator) {
  await app.locator(".leaflet-map-pane").evaluate(
    (pane) =>
      new Promise<void>((resolve) => {
        const proxy = pane.querySelector(".leaflet-proxy") as HTMLElement | null;
        let last = "";
        let frames = 0;
        let since = performance.now();
        const tick = () => {
          const moving = /leaflet-(zoom|pan)-anim/.test(pane.className);
          const scale = proxy?.style.transform ?? "";
          if (moving || scale !== last) {
            frames = 0;
            since = performance.now();
          } else {
            frames += 1;
          }
          last = scale;
          if (frames >= 5 && performance.now() - since >= 100) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}
