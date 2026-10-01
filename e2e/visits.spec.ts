/**
 * 訪問スタンプの E2E。
 *
 * **匿名とサインイン済みで別のサーバーを使う。** 1 つのプロセスはどちらか
 * 一方で、両方の画面を同時には出せない。サインイン済みの側は偽の利用者で
 * 動いている（`IEKEI_DEV_VISITOR`。main.ts にしか無い道）。
 */
import { expect, test, type FrameLocator } from "@playwright/test";
import {
  afterDelivered,
  callTool,
  MEMBER_SERVER_NAME,
  MEMBER_SERVER_URL,
  shopCards,
  shopName,
  waitForApp,
} from "./helpers";

/** 1 軒目を選んで、詳細（操作の並び）が出るまで待つ。 */
async function selectFirst(app: FrameLocator): Promise<string> {
  const first = shopCards(app).first();
  const name = await shopName(first);
  await first.click();
  await expect(app.getByRole("button", { name: "この店について聞く" })).toBeVisible();
  return name;
}

test.describe("匿名のまま", () => {
  test("「行った店」を開いても失敗にせず、サインインへ案内する", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    await app.getByRole("tab", { name: "行った店" }).click();

    // ここで tool を呼ばないので payload は前のモードのまま。「結果を取得できません
    // でした」を出すと、失敗していないのに失敗に見える。
    await expect(app.getByRole("button", { name: "チャットでサインインする" })).toBeVisible();
    await expect(app.getByText("結果を取得できませんでした")).toHaveCount(0);
  });

  test("匿名の「行った」もサインインの依頼も、チャットに届く", async ({ page }) => {
    /*
     * この 2 つは UI から tool を呼べない経路で、**チャットへ一通送るのが
     * 仕事そのもの**。押せることだけを見ていると、送信が壊れても気付けない。
     */
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);
    await selectFirst(app);

    await app.getByRole("button", { name: "行った", exact: true }).click();
    await page.getByText(/💬 Messages/).click();
    await expect(page.locator("pre").filter({ hasText: "[user]" })).toContainText(
      "stamp-iekei-ramen",
    );

    await app.getByRole("tab", { name: "行った店" }).click();
    await app.getByRole("button", { name: "チャットでサインインする" }).click();
    await expect(page.locator("pre").filter({ hasText: "[user]" })).toContainText(
      "show-visited-iekei-ramen",
    );
  });

  test("「行った」は押せるが、記録ではなくチャットへの依頼だと書いてある", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);
    await selectFirst(app);

    await expect(app.getByRole("button", { name: "行った", exact: true })).toBeEnabled();
    await expect(app.getByText("記録にはサインインが要ります")).toBeVisible();
  });
});

test.describe("サインイン済み", () => {
  /*
   * **この describe だけは並列にしない。** 記録は 3132 のプロセスに 1 つしか
   * 無く、テストの頭で消してから始める。ほかのテストと同時に流すと、
   * 走っている最中に記録を消し合う。設定の `fullyParallel` をここで打ち消し、
   * 1 つの worker で順に流す。
   */
  test.describe.configure({ mode: "default" });

  /*
   * 記録はサーバーのプロセスに残るので、テストごとに空から始める。
   * 前のテストの 1 軒が残っていると、「行った」の釦が「行ったを取り消す」に
   * なっていて、同じ手順が通らない。
   */
  test.beforeEach(async ({ page }) => {
    await callTool(page, "forget-my-iekei-ramen-visits", {}, MEMBER_SERVER_NAME);
  });

  test("「行った」を押しても画面が飛ばず、その場で印が付く", async ({ page }) => {
    const app = await callTool(
      page,
      "search-iekei-ramen",
      { prefecture: "神奈川県" },
      MEMBER_SERVER_NAME,
    );
    await waitForApp(app);
    const name = await selectFirst(app);

    await app.getByRole("button", { name: "行った", exact: true }).click();

    /*
     * **検索結果の画面に留まること。** スタンプの応答は mode: "visited" で返るので、
     * payload ごと差し替えると「行った店」の画面へ飛ばされ、選んでいた店も外れる。
     */
    await expect(app.getByRole("tab", { name: "検索フォーム" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(app.getByRole("button", { name: "行ったを取り消す" })).toBeVisible();
    await expect(shopCards(app).first().getByText("行った")).toBeVisible();

    // 「行った店」へ移ると、その 1 軒と制覇率が出る。
    await app.getByRole("tab", { name: "行った店" }).click();
    // 件数はデータ由来なので総数を書かない。記録が 1 軒になったことだけ見る。
    await expect(app.getByText(/^1 \/ \d+ 軒$/)).toBeVisible();
    await expect(shopCards(app).first()).toContainText(name);
  });

  test("「行った店」は、見出しも中身も記録のもの", async ({ page }) => {
    const app = await callTool(
      page,
      "search-iekei-ramen",
      { prefecture: "神奈川県" },
      MEMBER_SERVER_NAME,
    );
    await waitForApp(app);
    await selectFirst(app);
    await app.getByRole("button", { name: "行った", exact: true }).click();
    await expect(app.getByRole("button", { name: "行ったを取り消す" })).toBeVisible();

    await app.getByRole("tab", { name: "行った店" }).click();

    /*
     * **結果が届くまで待ってから見出しを見る。** 届く前の見出しはモードの名前
     * そのもの（「行った店」）なので、待たずに見ると、届いたあとに
     * 「全国の家系ラーメン」へ化けていても気付けない（実際に見落とした）。
     */
    await expect(shopCards(app)).toHaveCount(1);
    await expect(app.getByRole("heading", { level: 1 })).toHaveText("行った店");
    // 条件の入力欄も出さない。ここで県や味を変えると検索に化けて、記録の画面から弾かれる。
    await expect(app.getByLabel("都道府県")).toHaveCount(0);
  });

  test("「行った店」で取り消すと、その場で一覧から消える", async ({ page }) => {
    const app = await callTool(
      page,
      "search-iekei-ramen",
      { prefecture: "神奈川県" },
      MEMBER_SERVER_NAME,
    );
    await waitForApp(app);
    await selectFirst(app);
    await app.getByRole("button", { name: "行った", exact: true }).click();
    await expect(app.getByRole("button", { name: "行ったを取り消す" })).toBeVisible();

    await app.getByRole("tab", { name: "行った店" }).click();
    await expect(shopCards(app)).toHaveCount(1);

    await shopCards(app).first().click();
    await app.getByRole("button", { name: "行ったを取り消す" }).click();

    /*
     * **この画面の中身は記録そのもの。** 記録だけ更新して一覧を残すと、
     * 取り消した店が「行った」釦付きのまま並ぶ。
     */
    await expect(app.getByText("まだ記録がありません")).toBeVisible();
    await expect(shopCards(app)).toHaveCount(0);
  });

  test("続けて 2 軒押しても、先に押した応答が後の記録を消さない", async ({ page }) => {
    /*
     * 応答にはその時点の記録の全体が入っている。**1 本目の応答だけを遅らせる**と、
     * 古い写しが後から届く。素直に反映すると、あとから押した店が画面から消える
     * （記録そのものは両方残っているので、画面だけが嘘になる）。
     */
    let delayed = 0;
    // 遅らせた返事が届き切るまで待つための合図。**届く前に数えると、
    // 一瞬だけ正しい状態（2 件）に一致して通ってしまう**（実際に踏んだ）。
    let staleDelivered!: () => void;
    const stale = new Promise<void>((resolve) => {
      staleDelivered = resolve;
    });

    await page.route(`**/${MEMBER_SERVER_URL.split("//")[1]}`, async (route) => {
      const body = route.request().postData() ?? "";
      if (body.includes("stamp-iekei-ramen") && delayed++ === 0) {
        // サーバーには先に届かせ、返事だけを遅らせる（処理の順番は変えない）。
        const response = await route.fetch();
        const text = await response.text();
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await route.fulfill({ response, body: text });
        staleDelivered();
        return;
      }
      await route.continue();
    });

    const app = await callTool(
      page,
      "search-iekei-ramen",
      { prefecture: "神奈川県" },
      MEMBER_SERVER_NAME,
    );
    await waitForApp(app);

    await shopCards(app).nth(0).click();
    await app.getByRole("button", { name: "行った", exact: true }).click();
    await shopCards(app).nth(1).click();
    await app.getByRole("button", { name: "行った", exact: true }).click();

    // 遅らせた方の返事が画面に反映されるところまで見届けてから数える。
    await afterDelivered(app, stale);

    // タブを移らずに数える（移ると取り直してしまい、画面の嘘が消える）。
    await expect(
      app.locator("ul > li button span span").filter({ hasText: /^行った$/ }),
    ).toHaveCount(2);
  });

  test("「行った店」で取り消したら、モデルに渡した店も手放す", async ({ page }) => {
    const app = await callTool(
      page,
      "search-iekei-ramen",
      { prefecture: "神奈川県" },
      MEMBER_SERVER_NAME,
    );
    await waitForApp(app);
    await selectFirst(app);
    await app.getByRole("button", { name: "行った", exact: true }).click();
    await expect(app.getByRole("button", { name: "行ったを取り消す" })).toBeVisible();

    await app.getByRole("tab", { name: "行った店" }).click();
    await shopCards(app).first().click();
    // モデルコンテキストはホスト側のパネルに出る（アプリの iframe の外）。
    await expect(page.getByText("📋 Model Context")).toBeVisible();

    await app.getByRole("button", { name: "行ったを取り消す" }).click();

    /*
     * カードごと消えるので、詳細も「選択を解除」も画面から無くなる。
     * ここで手放さないと、**モデルには渡したまま、画面からは外せない**状態になる。
     */
    await expect(shopCards(app)).toHaveCount(0);
    await expect(page.getByText("📋 Model Context")).toHaveCount(0);
  });

  test("記録を書き換えている間だけ、タブが止まる", async ({ page }) => {
    /*
     * 記録の応答にも検索の応答にも、その時点の記録の全体が入っている。
     * 同時に走らせると**あとから届いた方が勝つ**ので、押したばかりの印が
     * 古い写しで消える。読み込み中のタブは開放したが、ここだけは止める。
     */
    const app = await callTool(
      page,
      "search-iekei-ramen",
      { prefecture: "神奈川県" },
      MEMBER_SERVER_NAME,
    );
    await waitForApp(app);
    await selectFirst(app);

    // 記録の応答だけを遅らせ、その間のタブを見る。
    await page.route(`**/${MEMBER_SERVER_URL.split("//")[1]}`, async (route) => {
      const body = route.request().postData() ?? "";
      if (body.includes('"stamp-iekei-ramen"')) {
        const response = await route.fetch();
        const text = await response.text();
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await route.fulfill({ response, body: text });
        return;
      }
      await route.continue();
    });

    await app.getByRole("button", { name: "行った", exact: true }).click();
    // **時間を切って見る。** 終わったあとの状態に一致させない。
    await expect(app.getByRole("tab", { name: "地図から探す" })).toBeDisabled({ timeout: 1000 });

    // 書き換えが終われば、また押せる。
    await expect(app.getByRole("tab", { name: "地図から探す" })).toBeEnabled({ timeout: 20_000 });
  });

  test("記録を全部消すのは 2 段階で、やめれば残る", async ({ page }) => {
    const app = await callTool(
      page,
      "search-iekei-ramen",
      { prefecture: "神奈川県" },
      MEMBER_SERVER_NAME,
    );
    await waitForApp(app);
    await selectFirst(app);
    await app.getByRole("button", { name: "行った", exact: true }).click();
    await expect(app.getByRole("button", { name: "行ったを取り消す" })).toBeVisible();

    await app.getByRole("tab", { name: "行った店" }).click();
    await app.getByRole("button", { name: "記録を全部消す" }).click();

    // 1 回目では消えない。元に戻せない操作を 1 回の誤操作で通さない。
    await expect(app.getByText("元に戻せません")).toBeVisible();
    await app.getByRole("button", { name: "やめる" }).click();
    await expect(shopCards(app)).toHaveCount(1);

    await app.getByRole("button", { name: "記録を全部消す" }).click();
    await app.getByRole("button", { name: "本当に全部消す" }).click();
    await expect(app.getByText("まだ記録がありません")).toBeVisible();
  });

  test("取り消しの返事を待つ間に別の店を選んでも、その選択は消えない", async ({ page }) => {
    /*
     * 返事が届いたときに「一覧から消えた店＝選択中の店」と決め打つと、
     * **その間に選び直した別の店**を消してしまう（モデルからも外れる）。
     */
    const app = await callTool(
      page,
      "search-iekei-ramen",
      { prefecture: "神奈川県" },
      MEMBER_SERVER_NAME,
    );
    await waitForApp(app);
    for (const index of [0, 1]) {
      await shopCards(app).nth(index).click();
      await app.getByRole("button", { name: "行った", exact: true }).click();
      await expect(app.getByRole("button", { name: "行ったを取り消す" })).toBeVisible();
    }

    // 取り消しの返事だけを遅らせ、その間に別の店を選ぶ。
    await page.route(`**/${MEMBER_SERVER_URL.split("//")[1]}`, async (route) => {
      const body = route.request().postData() ?? "";
      if (body.includes('"stamp-iekei-ramen"')) {
        const response = await route.fetch();
        const text = await response.text();
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await route.fulfill({ response, body: text });
        return;
      }
      await route.continue();
    });

    await app.getByRole("tab", { name: "行った店" }).click();
    await expect(shopCards(app)).toHaveCount(2);

    await shopCards(app).nth(0).click();
    await app.getByRole("button", { name: "行ったを取り消す" }).click();
    const kept = await shopName(shopCards(app).nth(1));
    await shopCards(app).nth(1).click();

    // 返事が届いて一覧が 1 軒になっても、選び直した店は選ばれたまま。
    await expect(shopCards(app)).toHaveCount(1, { timeout: 20_000 });
    await expect(app.getByRole("region", { name: "選択中の店舗" })).toBeVisible();
    await expect(page.getByText("📋 Model Context")).toBeVisible();
    await expect(shopCards(app).first()).toContainText(kept);
  });

  test("消している間は、記録を変える釦が画面に無い", async ({ page }) => {
    /*
     * 消去と 1 軒ずつの記録が同時に走ると、応答の順によって画面とサーバーが
     * ずれる（どちらの応答にもその時点の記録の全体が入っているため）。
     *
     * **いまはその窓が無い。** 消している間、一覧は「読み込み中…」に変わり、
     * 選択も外れるので、押せる釦そのものが画面に無い。ここが崩れると窓が開く
     * ので、性質として固定しておく（逆向き——記録の最中に消す——は、
     * 消す釦が busy で押せないことで塞がっている）。
     */
    const app = await callTool(
      page,
      "search-iekei-ramen",
      { prefecture: "神奈川県" },
      MEMBER_SERVER_NAME,
    );
    await waitForApp(app);
    await selectFirst(app);
    await app.getByRole("button", { name: "行った", exact: true }).click();
    await expect(app.getByRole("button", { name: "行ったを取り消す" })).toBeVisible();

    // 消去の返事を遅らせて、消している最中の画面を止めて見る。
    await page.route(`**/${MEMBER_SERVER_URL.split("//")[1]}`, async (route) => {
      const body = route.request().postData() ?? "";
      if (body.includes('"forget-my-iekei-ramen-visits"')) {
        const response = await route.fetch();
        const text = await response.text();
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await route.fulfill({ response, body: text });
        return;
      }
      await route.continue();
    });

    await app.getByRole("tab", { name: "行った店" }).click();
    await expect(shopCards(app)).toHaveCount(1);
    await app.getByRole("button", { name: "記録を全部消す" }).click();
    await app.getByRole("button", { name: "本当に全部消す" }).click();

    /*
     * 返事が届く前の画面を見る。**時間を切ること**——既定の待ちのままだと、
     * 返事が届いて空になった後の状態に一致してしまい、窓が開いていても通る
     * （実際にそうなっていた）。返事は 2.5 秒後なので、1 秒で判断する。
     */
    await expect(app.getByText("読み込み中…")).toBeVisible({ timeout: 1000 });
    await expect(shopCards(app)).toHaveCount(0, { timeout: 1000 });
    await expect(app.getByRole("button", { name: /^行った/ })).toHaveCount(0, { timeout: 1000 });

    // 届いたあとは、ふつうに空の画面になる。
    await expect(app.getByText("まだ記録がありません")).toBeVisible({ timeout: 20_000 });
  });

  test("地図では、行った店だと読み上げにも分かる", async ({ page }) => {
    const app = await callTool(
      page,
      "search-iekei-ramen",
      { prefecture: "神奈川県" },
      MEMBER_SERVER_NAME,
    );
    await waitForApp(app);
    const name = await selectFirst(app);
    await app.getByRole("button", { name: "行った", exact: true }).click();
    await expect(app.getByRole("button", { name: "行ったを取り消す" })).toBeVisible();

    await app.getByRole("tab", { name: "地図から探す" }).click();
    // 色や点は見えない人に届かない。印の名前そのものに入れてある。
    await expect(app.getByRole("button", { name: new RegExp(`${name}.*行った`) })).toHaveCount(1, {
      timeout: 20_000,
    });
    await expect(app.getByText("中心に白い点のあるピン")).toBeVisible();
  });
});
