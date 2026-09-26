/**
 * MCP Apps の E2E。
 * 実ブラウザ・実ホスト・実 MCP サーバーを通して 3 モードを操作する。
 */
import { expect, test } from "@playwright/test";
import { appFrame, callTool, plottedShops, shopCards, shopName, waitForApp } from "./helpers";

test.describe("検索フォーム", () => {
  test("全国の店舗を一覧表示する", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen");
    await waitForApp(app);

    await expect(app.getByRole("heading", { name: /全国の家系ラーメン/ })).toBeVisible();
    await expect(app.getByText(/\d+ 件/)).toBeVisible();
    expect(await shopCards(app).count()).toBeGreaterThan(10);
  });

  test("都道府県で絞り込むと結果が変わる", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen");
    await waitForApp(app);

    await app.locator("#pref").selectOption("神奈川県");
    await app.getByRole("button", { name: "検索" }).click();

    await expect(app.getByRole("heading", { name: /神奈川県の家系ラーメン/ })).toBeVisible();
    await expect(shopCards(app).first()).toContainText("神奈川県");
  });

  test("味の傾向で絞り込む", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    // フォームモードは条件を選んでから「検索」を押して確定する
    await app.getByRole("button", { name: "直系・濃厚", exact: true }).click();
    await app.getByRole("button", { name: "検索" }).click();

    // 絞り込み後はすべてのカードに「直系・濃厚」バッジが付く
    const cards = shopCards(app);
    // first() は自動待機するので、一覧が描き終わるまでここで待つ
    await expect(cards.first()).toContainText("直系・濃厚");
    for (const text of await cards.allTextContents()) {
      expect(text).toContain("直系・濃厚");
    }
  });

  test("キーワードで店名を検索する", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen");
    await waitForApp(app);

    await app.locator("#kw").fill("吉村家");
    await app.getByRole("button", { name: "検索" }).click();

    await expect(shopCards(app).first()).toContainText("吉村家");
  });

  test("該当が無ければその旨を表示する", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen");
    await waitForApp(app);

    await app.locator("#kw").fill("存在しない店名ZZZ");
    await app.getByRole("button", { name: "検索" }).click();

    await expect(app.getByText("条件に合う店舗が見つかりませんでした。")).toBeVisible();
    await expect(shopCards(app)).toHaveCount(0);
  });
});

test.describe("現在地から探す", () => {
  test("現在地未指定では結果を出さない", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen");
    await waitForApp(app);

    await app.getByRole("tab", { name: "現在地から探す" }).click();

    await expect(app.getByRole("heading", { name: "現在地から家系ラーメンを探す" })).toBeVisible();
    await expect(app.getByText("現在地を指定すると近い順に 5 件表示します。")).toBeVisible();
    await expect(shopCards(app)).toHaveCount(0);
  });

  test("地名を入力すると近い順に 5 件出る", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen");
    await waitForApp(app);
    await app.getByRole("tab", { name: "現在地から探す" }).click();

    await app.locator("#place").fill("横浜駅");
    await app.getByRole("button", { name: "この場所で探す" }).click();

    await expect(app.getByRole("heading", { name: /の近くの家系ラーメン/ })).toBeVisible();
    await expect(shopCards(app)).toHaveCount(5);
    // 距離表示（m または km）が付いている
    await expect(shopCards(app).first()).toContainText(/\d+(\.\d+)?(m|km)/);
  });

  test("ブラウザの位置情報が使えるホストでは現在地ボタンで検索できる", async ({
    page,
    context,
  }) => {
    // basic-host はリソースの permissions.geolocation を読んで iframe に allow を付ける
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 35.4658, longitude: 139.6222 });

    const app = await callTool(page, "search-iekei-ramen");
    await waitForApp(app);
    await app.getByRole("tab", { name: "現在地から探す" }).click();
    await app.getByRole("button", { name: "現在地から探す", exact: true }).click();

    await expect(shopCards(app)).toHaveCount(5);
    await expect(app.getByText("基準: 現在地")).toBeVisible();
  });

  test("位置情報が塞がれたホストでは地名入力を促す", async ({ page, context }) => {
    // ChatGPT のように iframe の geolocation が使えない状況を再現する。
    // basic-host はホスト側の現在地も渡さないので、地名入力に落ちるのが正しい。
    await context.clearPermissions();

    const app = await callTool(page, "search-iekei-ramen");
    await waitForApp(app);
    await app.getByRole("tab", { name: "現在地から探す" }).click();
    await app.getByRole("button", { name: "現在地から探す", exact: true }).click();

    await expect(
      app.getByText("現在地を取得できませんでした。下の欄に地名を入力してください。"),
    ).toBeVisible();
    // ボタンは押せる状態のまま残す
    await expect(app.getByRole("button", { name: "現在地から探す", exact: true })).toBeEnabled();
  });

  test("距離が近い順に並ぶ", async ({ page }) => {
    const app = await callTool(page, "find-nearby-iekei-ramen", {
      lat: 35.4658,
      lon: 139.6222,
      limit: 5,
      label: "横浜駅",
    });
    await waitForApp(app);

    const texts = await shopCards(app).allInnerTexts();
    const meters = texts.map((t) => {
      const [, value, unit] = t.match(/(\d+(?:\.\d+)?)(m|km)\s*$/m) ?? [];
      return unit === "km" ? Number(value) * 1000 : Number(value);
    });
    expect(meters).toEqual(meters.toSorted((a, b) => a - b));
  });

  test("ホストから直接呼ぶと基準地点が表示される", async ({ page }) => {
    const app = await callTool(page, "find-nearby-iekei-ramen", {
      lat: 35.4658,
      lon: 139.6222,
      label: "横浜駅",
    });
    await waitForApp(app);

    await expect(app.getByText("基準: 横浜駅")).toBeVisible();
    await expect(app.getByRole("heading", { name: "横浜駅の近くの家系ラーメン" })).toBeVisible();
  });
});

test.describe("地図から探す", () => {
  test("地図とマーカーを描画する", async ({ page }) => {
    const app = await callTool(page, "show-iekei-ramen-map");
    await waitForApp(app);

    const map = app.getByRole("application", { name: "家系ラーメン店の地図" });
    await expect(map).toBeVisible();
    // Leaflet の circleMarker は SVG path として描かれる
    await expect(map.locator("svg path").first()).toBeVisible();
    /*
     * 重なる店は塊にまとまるので、ピンの数は店の数と一致しない。
     * **塊の件数を足すと全件になる**——そこを見張る。
     */
    expect(await plottedShops(app)).toBe(558);
  });

  test("OpenStreetMap の出典を表示する", async ({ page }) => {
    const app = await callTool(page, "show-iekei-ramen-map");
    await waitForApp(app);

    await expect(app.getByRole("link", { name: "OpenStreetMap" }).first()).toBeVisible();
  });

  test("地図モードではキーワード欄を出さない", async ({ page }) => {
    const app = await callTool(page, "show-iekei-ramen-map");
    await waitForApp(app);

    await expect(app.locator("#pref")).toBeVisible();
    await expect(app.locator("#kw")).toHaveCount(0);
  });

  test("都道府県を選ぶとマーカーが絞られる", async ({ page }) => {
    const app = await callTool(page, "show-iekei-ramen-map");
    await waitForApp(app);

    const before = await plottedShops(app);

    await app.locator("#pref").selectOption("神奈川県");
    await expect(app.getByRole("heading", { name: /神奈川県の家系ラーメン/ })).toBeVisible();

    await expect.poll(() => plottedShops(app)).toBeLessThan(before);
    expect(await plottedShops(app)).toBeGreaterThan(0);
  });
});

test.describe("モード切り替え", () => {
  test("3 モードを行き来できる", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen");
    await waitForApp(app);

    await app.getByRole("tab", { name: "地図から探す" }).click();
    await expect(app.getByRole("application", { name: "家系ラーメン店の地図" })).toBeVisible();

    await app.getByRole("tab", { name: "現在地から探す" }).click();
    await expect(app.getByRole("button", { name: "現在地から探す", exact: true })).toBeVisible();

    await app.getByRole("tab", { name: "検索フォーム" }).click();
    await expect(app.locator("#kw")).toBeVisible();
  });

  test("どのモードでも出典の注記を表示する", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen");
    await waitForApp(app);

    await expect(app.getByText(/OpenStreetMap（ODbL）由来/)).toBeVisible();
  });

  test("狭いホストでもタブが溝からはみ出さない", async ({ page }) => {
    // 携帯の幅（375px）のホストに置かれることがある。和文ラベル 3 つは
    // 1 行に収まりきらず、以前は溝の外へ出て横スクロールが生まれていた。
    await page.setViewportSize({ width: 375, height: 800 });
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    const overflow = await app.locator('[role="tablist"]').evaluate((el) => ({
      track: el.scrollWidth - el.clientWidth,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow.track).toBe(0);
    expect(overflow.page).toBe(0);
  });
});

/** 根拠の一文から母数（「〜 軒を」）を取り出す。 */
function poolSize(basis: string): string | undefined {
  return basis.match(/(\d+) 軒を/)?.[1];
}

test.describe("迷ったら（3 軒に絞る）", () => {
  test("3 軒まで絞り、なぜこの 3 軒かを画面に出す", async ({ page }) => {
    const app = await callTool(page, "decide-iekei-ramen", {
      lat: 35.4657,
      lon: 139.622,
      label: "横浜駅",
    });
    await waitForApp(app);

    await expect(shopCards(app)).toHaveCount(3);
    // 根拠を出さないと、根拠の無い「おすすめ」を押し付けているように見える。
    await expect(app.getByText(/横浜駅から近い順に並べ/)).toBeVisible();
    await expect(app.getByText(/順位は「おすすめ度」ではありません/)).toBeVisible();
  });

  test("3 軒とも一度に見える（一覧の中で切れない）", async ({ page }) => {
    const app = await callTool(page, "decide-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    /*
     * 比べてから決めるので、3 軒目が切れていては意味がない。
     * 一覧は他のモードでは高さを 26rem に制限してスクロールさせているが、
     * 「迷ったら」では外してある。画面の位置ではなく、一覧自身がはみ出して
     * いないことを見る。
     *
     * 1 軒選んでから測る。カードだけなら 26rem に収まってしまい、制限が
     * 残っていても気付けない。詳細が開いた状態が、実際に切れていた形。
     */
    await shopCards(app).nth(1).click();
    await expect(app.getByRole("region", { name: "選択中の店舗" })).toBeVisible();

    const overflow = await app
      .locator("ul")
      .first()
      .evaluate((ul) => ul.scrollHeight - ul.clientHeight);
    expect(overflow).toBe(0);
  });

  test("「別の候補を見る」で中身が入れ替わる", async ({ page }) => {
    const app = await callTool(page, "decide-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    const before = await Promise.all([0, 1, 2].map((i) => shopName(shopCards(app).nth(i))));
    await expect(app.getByText("1 / ")).toBeVisible();

    await app.getByRole("button", { name: "別の候補を見る" }).click();
    await expect(app.getByText("2 / ")).toBeVisible();

    const after = await Promise.all([0, 1, 2].map((i) => shopName(shopCards(app).nth(i))));
    expect(after).not.toEqual(before);
    // 乱数ではなく次の 3 軒なので、前の 3 軒とは重ならない。
    expect(after.filter((n) => before.includes(n))).toEqual([]);
  });

  test("「この 3 軒から選ぶ」でチャットに 3 軒を流す", async ({ page }) => {
    const app = await callTool(page, "decide-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    const names = await Promise.all([0, 1, 2].map((i) => shopName(shopCards(app).nth(i))));
    await app.getByRole("button", { name: "この 3 軒から選ぶ" }).click();

    // ホストの会話欄は畳まれているので、開いてから本文を見る。
    const messages = page.getByText(/💬 Messages/);
    await expect(messages).toBeVisible();
    await messages.click();

    const sent = page.locator("pre").filter({ hasText: "[user]" });
    await expect(sent).toContainText("この中から 1 軒を選んで");
    await Promise.all(names.map((name) => expect(sent).toContainText(name)));
    // 持っていないデータを推測させない断り書きが必ず付く。
    await expect(sent).toContainText("推測で補わず");
    await expect(sent).toContainText("このアプリのデータには含まれていません");
  });

  test("現在地タブに戻ると、近い順を取り直す", async ({ page }) => {
    const app = await callTool(page, "decide-iekei-ramen", {
      lat: 35.4657,
      lon: 139.622,
      label: "横浜駅",
    });
    await waitForApp(app);
    await expect(shopCards(app)).toHaveCount(3);

    /*
     * タブを戻したときに tool を呼ばないと、直前の payload（3 軒）が
     * そのまま「近い順」として並ぶ。基準地点は引き継いでいるので取り直せる。
     */
    await app.getByRole("tab", { name: "現在地から探す" }).click();
    await expect(app.getByText("基準: 横浜駅")).toBeVisible();
    await expect(shopCards(app)).toHaveCount(5);
  });

  test("直前の検索のキーワードを、見えないまま効かせない", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", {
      prefecture: "神奈川県",
      keyword: "吉村家",
    });
    await waitForApp(app);
    await expect(shopCards(app)).toHaveCount(1);

    /*
     * 「迷ったら」はキーワード欄を出さない。残っていた語がそのまま効くと、
     * 候補が減っていても理由が画面に出ず、外す手立ても無い。
     */
    await app.getByRole("tab", { name: "迷ったら" }).click();
    await expect(app.locator("#kw")).toHaveCount(0);
    await expect(shopCards(app)).toHaveCount(3);
  });

  test("候補が 1 軒のときは、3 軒の言い方をしない", async ({ page }) => {
    // 神奈川県は 79 軒 = 27 巡で、最終巡は 1 軒。
    const app = await callTool(page, "decide-iekei-ramen", {
      prefecture: "神奈川県",
      round: 26,
    });
    await waitForApp(app);

    await expect(shopCards(app)).toHaveCount(1);
    await expect(app.getByRole("heading", { name: /迷ったらこの 1 軒/ })).toBeVisible();
    await expect(app.getByRole("button", { name: "この 1 軒について聞く" })).toBeVisible();
    await expect(app.getByRole("button", { name: /この 3 軒から選ぶ/ })).toHaveCount(0);
  });

  test("モデルが付けたキーワードを、巡回しても落とさない", async ({ page }) => {
    const app = await callTool(page, "decide-iekei-ramen", { keyword: "横浜" });
    await waitForApp(app);

    /*
     * キーワードを落とすと母数が全国に広がり、「次の候補」として無関係な店が
     * 出る。効いている語は根拠の一文にも書いて、隠れた絞り込みにしない。
     */
    const pool = await app.locator("section p").first().innerText();
    expect(pool).toContain("「横浜」に合う");

    await app.getByRole("button", { name: "別の候補を見る" }).click();
    await expect(app.getByText("2 / ")).toBeVisible();

    const after = await app.locator("section p").first().innerText();
    expect(after).toContain("「横浜」に合う");
    // 母数（〜軒）が変わっていないこと。広がると無関係な店が混ざる。
    expect(poolSize(after)).toBe(poolSize(pool));
  });

  test("同じタブをもう一度押しても、効いているキーワードを落とさない", async ({ page }) => {
    /*
     * 別のタブから入り直すときは、検索フォームに残っていた語を持ち込まない。
     * だが「いま居るタブをもう一度押す」は入り直しではない。ここで落とすと、
     * 押しただけで母数が全国に広がり、チップも消えて理由が残らない。
     */
    const app = await callTool(page, "decide-iekei-ramen", { keyword: "横浜" });
    await waitForApp(app);
    const before = await app.locator("section p").first().innerText();
    expect(before).toContain("「横浜」に合う");

    await app.getByRole("tab", { name: "迷ったら" }).click();

    await expect(app.getByText("キーワード「横浜」")).toBeVisible();
    const after = await app.locator("section p").first().innerText();
    expect(after).toContain("「横浜」に合う");
    expect(poolSize(after)).toBe(poolSize(before));
  });

  test("現在地の精度を、迷ったらを経由しても書き換えない", async ({ page }) => {
    const app = await callTool(page, "find-nearby-iekei-ramen", {
      lat: 35.4657,
      lon: 139.622,
      label: "現在地",
      source: "precise",
      limit: 5,
    });
    await waitForApp(app);
    await expect(app.getByText("基準: 現在地", { exact: true })).toBeVisible();

    // place に固定していると「（指定した地名）」が付いて、精度が偽られる。
    await app.getByRole("tab", { name: "迷ったら" }).click();
    await expect(shopCards(app)).toHaveCount(3);
    await app.getByRole("tab", { name: "現在地から探す" }).click();

    await expect(app.getByText("基準: 現在地", { exact: true })).toBeVisible();
    await expect(app.getByText("指定した地名")).toHaveCount(0);
  });

  test("label 無しの座標を引き継いでも、基準地点で「現在地」と名乗らない", async ({ page }) => {
    /*
     * モデルが座標だけ渡して「迷ったら」を開くことがある。そのまま現在地タブへ
     * 持ち越すと、見出しは座標なのに基準の表示だけ「現在地（指定した地名）」に
     * なり、端末から取った位置のように見える。
     */
    const app = await callTool(page, "decide-iekei-ramen", { lat: 35.4657, lon: 139.622 });
    await waitForApp(app);
    await expect(shopCards(app)).toHaveCount(3);

    await app.getByRole("tab", { name: "現在地から探す" }).click();
    await expect(shopCards(app)).toHaveCount(5);

    await expect(app.getByText(/基準: 現在地/)).toHaveCount(0);
    await expect(app.getByText("基準: 35.4657, 139.6220（指定した地名）")).toBeVisible();
  });

  test("ホスト由来の位置でも、迷ったらを経由して現在地に戻れる", async ({ page }) => {
    /*
     * ChatGPT のように iframe の位置情報が塞がれたホストでは、座標の出どころは
     * host になる。「迷ったら」を経由するとその値がそのまま現在地モードへ渡るので、
     * 受け側が precise / place しか認めないと検証エラーで戻れなくなる。
     */
    const app = await callTool(page, "find-nearby-iekei-ramen", {
      lat: 35.4657,
      lon: 139.622,
      label: "だいたいの現在地",
      source: "host",
      limit: 5,
    });
    await waitForApp(app);
    await expect(shopCards(app)).toHaveCount(5);

    await app.getByRole("tab", { name: "迷ったら" }).click();
    await expect(shopCards(app)).toHaveCount(3);

    await app.getByRole("tab", { name: "現在地から探す" }).click();
    await expect(shopCards(app)).toHaveCount(5);
    await expect(app.getByText(/だいたいの位置/)).toBeVisible();
  });

  test("店を開いたまま選んでもらうと、その選択を先に外す", async ({ page }) => {
    const app = await callTool(page, "decide-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    await shopCards(app).nth(1).click();
    await expect(app.getByRole("region", { name: "選択中の店舗" })).toBeVisible();

    /*
     * ホスト側のパネルに「選択した店舗」が載ったことを確かめてから送る。
     * パネルは折りたたみで、閉じていると中身の pre がそもそも存在しない。
     * 開かずに「消えたこと」を数えると、常に 0 になって何も見張らない。
     */
    await page.getByText("📋 Model Context").click();
    const inContext = page.locator("pre").filter({ hasText: "ユーザーが UI で選択した店舗" });
    await expect(inContext).toHaveCount(1);

    /*
     * 「この店を選んだ」という文脈を残したまま「この中から選んで」と頼むと、
     * 相反する 2 つが同時に届き、答えが開いていた店に引きずられる。
     * updateModelContext は次の発話まで待つので、送ってから消しても遅い。
     */
    await app.getByRole("button", { name: /軒から選ぶ/ }).click();

    await expect(app.getByRole("region", { name: "選択中の店舗" })).toHaveCount(0);
    await expect(inContext).toHaveCount(0);

    const messages = page.getByText(/💬 Messages/);
    await expect(messages).toBeVisible();
    await messages.click();
    await expect(page.locator("pre").filter({ hasText: "[user]" })).toContainText(
      "この中から 1 軒を選んで",
    );
  });

  test("切り替えに失敗したら、前のモードの結果を出さない", async ({ page }) => {
    // 全国の地図（558 件）を出してから、tool 呼び出しを落とす。
    const app = await callTool(page, "show-iekei-ramen-map", {});
    await waitForApp(app);
    await expect(shopCards(app)).toHaveCount(20);

    await page.route("**/mcp", (route) => route.abort());
    await app.getByRole("tab", { name: "迷ったら" }).click();

    /*
     * mode だけ先に変わり、payload は前のモードのまま残る。出してしまうと
     * 558 件が「迷ったら」の候補として並び、「この 558 軒から選ぶ」ボタンまで
     * 押せてしまう（実際にそうなっていた）。
     */
    await expect(
      app.getByText("結果を取得できませんでした。もう一度お試しください。"),
    ).toBeVisible();
    await expect(shopCards(app)).toHaveCount(0);
    await expect(app.getByRole("button", { name: /軒から選ぶ/ })).toHaveCount(0);
    await expect(app.getByRole("button", { name: "別の候補を見る" })).toHaveCount(0);
    // 見出しも前のモードの件数を名乗らない。
    await expect(app.getByRole("heading", { name: "迷ったら", exact: true })).toBeVisible();
  });

  test("条件を変えて失敗したら、前の条件の候補を残さない", async ({ page }) => {
    const app = await callTool(page, "decide-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);
    const before = await Promise.all([0, 1, 2].map((i) => shopName(shopCards(app).nth(i))));

    /*
     * モードは decide のままなので、mode と payload.mode の比較だけでは
     * 古くなったことに気付けない。プルダウンは東京都を指しているのに候補は
     * 神奈川県のまま残り、そのままモデルへ送れてしまっていた。
     */
    await page.route("**/mcp", (route) => route.abort());
    await app.locator("#pref").selectOption("東京都");

    await expect(
      app.getByText("結果を取得できませんでした。もう一度お試しください。"),
    ).toBeVisible();
    await expect(app.locator("#pref")).toHaveValue("東京都");
    await expect(shopCards(app)).toHaveCount(0);
    await expect(app.getByRole("button", { name: /軒から選ぶ/ })).toHaveCount(0);
    expect(before).toHaveLength(3);
  });

  test("条件を変えて失敗しても、開いていた店をモデルに残さない", async ({ page }) => {
    /*
     * 一覧を差し替える呼び出しが落ちると、候補も選択中パネルも画面から消える。
     * それでもホストのモデル文脈には開いていた店が載ったままで、画面には外す
     * 手段が無い。そのあとの会話が、消えたはずの店を指したまま進む。
     */
    const app = await callTool(page, "decide-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    await shopCards(app).nth(1).click();
    await expect(app.getByRole("region", { name: "選択中の店舗" })).toBeVisible();
    // 折りたたまれたままだと pre が無く、何も見張らないテストになる。開いて見る。
    await page.getByText("📋 Model Context").click();
    const inContext = page.locator("pre").filter({ hasText: "ユーザーが UI で選択した店舗" });
    await expect(inContext).toHaveCount(1);

    await page.route("**/mcp", (route) => route.abort());
    await app.locator("#pref").selectOption("東京都");

    await expect(
      app.getByText("結果を取得できませんでした。もう一度お試しください。"),
    ).toBeVisible();
    await expect(app.getByRole("region", { name: "選択中の店舗" })).toHaveCount(0);
    await expect(inContext).toHaveCount(0);
  });

  test("条件を続けて変えても、古い応答に巻き戻されない", async ({ page }) => {
    /*
     * 都道府県を続けて変えると呼び出しが 2 本走り、先に出した方が後から返る
     * ことがある。素直に反映すると、後から選んだ条件が古い結果で上書きされ、
     * payload から作り直されるフォームまで前の値に戻る。
     */
    await page.route("**/mcp", async (route) => {
      const body = route.request().postData() ?? "";
      // 先に出す「東京都」だけ遅らせて、後から出す「大阪府」を追い越させる。
      if (body.includes("tools/call") && body.includes("東京都")) {
        await new Promise((r) => setTimeout(r, 2500));
      }
      await route.continue();
    });

    const app = await callTool(page, "decide-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    await app.locator("#pref").selectOption("東京都");
    await app.locator("#pref").selectOption("大阪府");

    await expect(app.locator("#pref")).toHaveValue("大阪府");
    await expect(shopCards(app)).toHaveCount(3);
    await expect(shopCards(app).first()).toContainText("大阪府");
    // 遅れて届く東京都の結果で巻き戻らないこと。
    await page.waitForTimeout(3000);
    await expect(app.locator("#pref")).toHaveValue("大阪府");
    await expect(shopCards(app).first()).toContainText("大阪府");
  });

  test("label 無しの座標でも、見出しが「全国」にならない", async ({ page }) => {
    const app = await callTool(page, "decide-iekei-ramen", { lat: 35.4657, lon: 139.622 });
    await waitForApp(app);

    // 距離で並べた結果なので、場所を名乗らないと何の 3 軒か分からない。
    await expect(app.getByRole("heading", { name: /35\.4657, 139\.6220/ })).toBeVisible();
    await expect(app.getByRole("heading", { name: /（全国）/ })).toHaveCount(0);
    await expect(app.getByText(/35\.4657, 139\.6220から近い順/)).toBeVisible();
  });

  test("モデルが付けたキーワードは、0 件でも見えて外せる", async ({ page }) => {
    const app = await callTool(page, "decide-iekei-ramen", { keyword: "存在しない店名ZZZ" });
    await waitForApp(app);

    /*
     * このモードにキーワード欄は無い。出さないと、なぜ 0 件なのかも、どうすれば
     * 外れるのかも分からない。見出しも「この 0 軒」と名乗らない。
     */
    await expect(shopCards(app)).toHaveCount(0);
    await expect(app.getByText("キーワード「存在しない店名ZZZ」")).toBeVisible();
    await expect(app.getByText(/上のキーワードを外すか/)).toBeVisible();
    await expect(app.getByRole("heading", { name: "迷ったら", exact: true })).toBeVisible();

    await app.getByRole("button", { name: "このキーワードを外す" }).click();

    await expect(shopCards(app)).toHaveCount(3);
    await expect(app.getByText("存在しない店名ZZZ")).toHaveCount(0);
  });

  test("続けて押しても、そのたび選択を外しに行く", async ({ page }) => {
    const app = await callTool(page, "decide-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    const first = await shopName(shopCards(app).nth(1));
    await shopCards(app).nth(1).click();
    await expect(app.getByRole("region", { name: "選択中の店舗" })).toBeVisible();
    await expect(page.getByText("📋 Model Context")).toBeVisible();

    const ask = app.getByRole("button", { name: /軒から選ぶ/ });
    await ask.click();
    await expect(app.getByRole("region", { name: "選択中の店舗" })).toHaveCount(0);

    /*
     * 2 回目も送れること。解除が失敗したあとに「決着済みの失敗」を使い回すと、
     * 誰も消しに行かないまま送ることになる。ここでは解除が成功する経路だが、
     * 押すたびに送信まで到達することを見ておく。
     */
    await shopCards(app).nth(2).click();
    await expect(app.getByRole("region", { name: "選択中の店舗" })).toBeVisible();
    await ask.click();
    await expect(app.getByRole("region", { name: "選択中の店舗" })).toHaveCount(0);
    await expect(
      page.locator("pre").filter({ hasText: "ユーザーが UI で選択した店舗" }),
    ).toHaveCount(0);

    const messages = page.getByText(/💬 Messages/);
    await messages.click();
    // ホストは会話を 1 つの pre にまとめて出すので、中身の数で見る。
    const sent = page.locator("pre").filter({ hasText: "[user]" });
    await expect(sent).toContainText(first);
    expect(((await sent.innerText()).match(/この中から 1 軒を選んで/g) ?? []).length).toBe(2);
  });

  test("1 軒選ぶと、そのカードの直下に操作が出る", async ({ page }) => {
    const app = await callTool(page, "decide-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    const target = shopCards(app).nth(1);
    const name = await shopName(target);
    await target.click();

    const detail = app.locator("li", { has: app.getByRole("region", { name: "選択中の店舗" }) });
    await expect(detail).toContainText(name);
    await expect(app.getByRole("button", { name: "この店について聞く" })).toBeVisible();
  });
});

test.describe("ホスト連携", () => {
  test("tool の引数がそのまま初期表示に反映される", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", {
      prefecture: "東京都",
      taste: "chain",
    });
    await waitForApp(app);

    await expect(app.locator("#pref")).toHaveValue("東京都");
    await expect(app.getByRole("heading", { name: /東京都の家系ラーメン/ })).toBeVisible();
    await expect(shopCards(app).first()).toContainText("チェーン・万人向け");
  });

  test("アプリがホストに接続できないままにならない", async ({ page }) => {
    await callTool(page, "search-iekei-ramen");
    const app = appFrame(page);

    await expect(app.getByText("読み込み中…")).toHaveCount(0);
    await expect(app.getByText(/接続エラー/)).toHaveCount(0);
  });
});

test.describe("モデルへの受け渡し", () => {
  test("店を選ぶと選択パネルが出る", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    const panel = app.getByRole("region", { name: "選択中の店舗" });
    await expect(panel).toHaveCount(0);

    await shopCards(app).first().click();

    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: "この店について聞く" })).toBeVisible();
  });

  test("選んだ店をホストのモデルコンテキストに渡す", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    const name = await shopName(shopCards(app).first());
    await shopCards(app).first().click();

    // モデルコンテキストはホスト側のパネルに出る（アプリの iframe の外）。
    const contextPanel = page.getByText("📋 Model Context");
    await expect(contextPanel).toBeVisible();
    await contextPanel.click();

    const contextText = page.locator("pre").filter({ hasText: "ユーザーが UI で選択した店舗" });
    await expect(contextText).toBeVisible();
    await expect(contextText).toContainText(name);
  });

  test("選択を解除するとモデルコンテキストを消す", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    await shopCards(app).first().click();
    await expect(page.getByText("📋 Model Context")).toBeVisible();

    await app.getByRole("button", { name: "選択を解除" }).click();

    await expect(app.getByRole("region", { name: "選択中の店舗" })).toHaveCount(0);
    await expect(page.getByText("📋 Model Context")).toHaveCount(0);
  });

  test("「この店について聞く」でチャットにメッセージを送る", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    const name = await shopName(shopCards(app).first());
    await shopCards(app).first().click();
    await app.getByRole("button", { name: "この店について聞く" }).click();

    const messages = page.getByText(/💬 Messages/);
    await expect(messages).toBeVisible();
    await messages.click();

    const sent = page.locator("pre").filter({ hasText: "[user]" });
    await expect(sent).toContainText(name);
    await expect(sent).toContainText("について教えて");
  });

  test("検索し直すと選択が外れる", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    await shopCards(app).first().click();
    await expect(app.getByRole("region", { name: "選択中の店舗" })).toBeVisible();

    await app.locator("#pref").selectOption("東京都");
    await app.getByRole("button", { name: "検索" }).click();

    await expect(app.getByRole("heading", { name: /東京都の家系ラーメン/ })).toBeVisible();
    await expect(app.getByRole("region", { name: "選択中の店舗" })).toHaveCount(0);
  });
});

test.describe("注文のカンペ", () => {
  test("店を選ぶとカンペが出て、開くと三つ巴が読める", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    const guide = app.getByText("注文のしかた（お好み・卓上・ライス）");
    await expect(guide).toHaveCount(0);

    await shopCards(app).first().click();
    await expect(guide).toBeVisible();

    // 畳んである状態では中身を出さない
    await expect(app.getByRole("row", { name: /麺の硬さ/ })).toBeHidden();

    await guide.click();
    await expect(app.getByRole("row", { name: /麺の硬さ/ })).toBeVisible();
    await expect(app.getByRole("row", { name: /味の濃さ/ })).toBeVisible();
    await expect(app.getByRole("row", { name: /脂の量/ })).toBeVisible();
  });

  test("回数別の頼み方と、断定しない断り書きを出す", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    await shopCards(app).first().click();
    await app.getByText("注文のしかた（お好み・卓上・ライス）").click();

    await expect(app.getByText("初めて")).toBeVisible();
    await expect(app.getByText("かため / ふつう / ふつう")).toBeVisible();
    // 店ごとの流儀は持っていないので、言い切らないこと
    await expect(app.getByText(/店ごとの決まりは持っていない/)).toBeVisible();
  });
});

test.describe("選択中の店の詳細", () => {
  test("選んだカードの直下に出る", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    const target = shopCards(app).nth(2);
    const name = await shopName(target);
    await target.click();

    // 詳細は選んだカードと同じ li の中にある（＝直下）
    const detail = app.locator("li", { has: app.getByRole("region", { name: "選択中の店舗" }) });
    await expect(detail).toContainText(name);
  });

  test("選んでも、その上のカードの並びが動かない", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    /*
     * 4 枚目と 1 枚目の間隔を、一覧の中での位置（offsetTop）で測る。
     *
     * 画面上の座標で測ってはいけない。選ぶと scrollIntoView が走り、一覧だけで
     * なくページ側もスクロールする。boundingBox を 2 回に分けて取ると、その間に
     * スクロール位置が変わって差が出る（CI で 7〜9px ぶれて落ちた）。
     * offsetTop はスクロールで動かないので、見たいもの（並び）だけが残る。
     */
    const gap = () =>
      app
        .locator("ul")
        .first()
        .evaluate((ul) => {
          const cards = [...ul.querySelectorAll(":scope > li > button")] as HTMLElement[];
          return cards[3].offsetTop - cards[0].offsetTop;
        });

    const gapBefore = await gap();
    await shopCards(app).nth(3).click();
    await expect(app.getByRole("region", { name: "選択中の店舗" })).toBeVisible();

    // 詳細は選んだカードの下に入るので、その上の並びは変わらない。
    // 一覧の上に差し込んでいた頃は、ここが詳細の高さ（約 250px）分ずれていた。
    // 選択枠の線 1px ぶんだけは動くので、そこは許容する。
    expect(Math.abs((await gap()) - gapBefore)).toBeLessThanOrEqual(2);
  });

  test("キーボードで選んでも焦点リングの黒い縁が残る", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    /*
     * Enter で選ぶと、カードは焦点を持ったまま親が選択中の見た目に変わる。
     * 黒い縁は box-shadow で描いているので、選択中の box-shadow: none に
     * 負けると黄だけが残り、淡い選択面の上でコントラスト 1.3 まで落ちる。
     */
    // :focus-visible はキーボードで移ったときだけ点く。1 枚目に焦点を置いてから
    // Tab で 2 枚目へ移す（プログラムから focus() しただけでは点かない）。
    // :focus-visible はキーボードで移ったときだけ点く。1 枚目に焦点を置いてから
    // Tab で 2 枚目へ移す（プログラムから focus() しただけでは点かない）。
    const card = shopCards(app).nth(1);
    await shopCards(app).first().focus();
    await page.keyboard.press("Tab");
    await expect(card).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(app.getByRole("region", { name: "選択中の店舗" })).toBeVisible();

    // 影は 120ms かけて変わるので、落ち着くまで待つ（途中は色が薄い）。
    const shadow = () => card.evaluate((el) => getComputedStyle(el).boxShadow);
    // --color-focus-edge (#141312)
    await expect.poll(shadow).toContain("rgb(20, 19, 18)");
    // --color-focus-ring (#ffd43d)
    await expect(card).toHaveCSS("outline-color", "rgb(255, 212, 61)");

    // マウスが乗っても消えない。選択中かつ hover の指定はクラス 3 つぶんの
    // 強さがあり、焦点の指定（クラス 2 つ）に順番だけでは勝てないため、
    // こちらは別に守る必要がある。
    await card.hover();
    await expect(card).toBeFocused();
    await expect.poll(shadow).toContain("rgb(20, 19, 18)");
  });

  test("選んだカードと詳細が同時に見える", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    // 一覧は高さを制限しているので、下の方のカードを選ぶと詳細が見切れていた
    const target = shopCards(app).nth(6);
    await target.click();

    await expect(target).toBeInViewport();
    await expect(app.getByRole("region", { name: "選択中の店舗" })).toBeInViewport();
  });

  test("別の店を押すと、解除しなくても詳細が移る", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    const second = shopCards(app).nth(1);
    const secondName = await shopName(second);
    await shopCards(app).nth(0).click();
    await second.click();

    // 詳細は 1 つだけで、2 件目のカードと同じ枠の中にある
    const detail = app.getByRole("region", { name: "選択中の店舗" });
    await expect(detail).toHaveCount(1);
    await expect(app.locator("li", { has: detail })).toContainText(secondName);
  });
});

test.describe("一覧の詰め方", () => {
  /*
   * ChatGPT のような広いホストで「窮屈で見づらい」と言われたのがきっかけ。
   * 幅が 1400px あってもカード 1 枚が 108px を使い、一覧に 4 枚弱しか
   * 収まっていなかった（横に 1000px 以上空いたまま縦に伸びていた）。
   */
  test("広いホストでは、カードを 1 行に収めて数を見せる", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 820 });
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    const card = await shopCards(app).first().boundingBox();
    expect(card).not.toBeNull();
    // 縦積みだと 108px。1 行に並べれば半分ほどに収まる。
    expect(card!.height).toBeLessThan(70);

    // 同じ一覧の高さに倍近く並ぶ。
    const list = await app.locator("ul").first().boundingBox();
    expect(list!.height / card!.height).toBeGreaterThan(6);
  });

  test("横に並べ始めた直後の幅でも、長い店名を折り返さない", async ({ page }) => {
    /*
     * 40rem を少し超えたあたりが一番きつい。順位番号・バッジ・距離も同じ行に
     * 並ぶので、店名に縮む指定（flex: 0 1 auto）を残していると真っ先に詰められ、
     * 20 文字超の店名が 2 行になってカードが 55px → 78px に戻る。
     *
     * 広い幅（1200px）で短い店名だけ見ていても、この状態は捕まえられない。
     */
    await page.setViewportSize({ width: 720, height: 900 });
    // 「横浜家系ラーメン 町田商店 柴田バイパス店」（21 文字）が 1 軒目に来る地点。
    const app = await callTool(page, "find-nearby-iekei-ramen", {
      lat: 38.0626,
      lon: 140.7613,
      label: "柴田",
      source: "place",
      limit: 5,
    });
    await waitForApp(app);
    await expect(shopCards(app).first()).toContainText("柴田バイパス店");

    const heights = await shopCards(app).evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().height)),
    );
    // 1 行に収まっていれば 55px 前後。折り返すと 78px 以上になる。
    expect(Math.max(...heights)).toBeLessThan(70);
  });

  test("横に並べても、一覧を横へ溢れさせない", async ({ page }) => {
    /*
     * 店名を縮めない指定にすると、縮まない要素（順位番号・バッジ・距離）だけで
     * 幅を超えたときに一覧が横スクロールする。縦の 1 行化と引き換えに横が
     * 壊れては意味がない。
     *
     * **いまのデータでは、縮めない指定に戻しても溢れない**（最長 21 文字の
     * 「横浜家系ラーメン 町田商店 柴田バイパス店」でも収まる）。このテストは
     * 判別力があるというより、店舗データを取り直して長い店名が増えたときに
     * 気付くための網。
     */
    await page.setViewportSize({ width: 680, height: 900 });
    const app = await callTool(page, "find-nearby-iekei-ramen", {
      lat: 38.0626,
      lon: 140.7613,
      label: "柴田",
      source: "place",
      limit: 5,
    });
    await waitForApp(app);

    const over = await app
      .locator("ul")
      .first()
      .evaluate((ul) => ({
        list: ul.scrollWidth - ul.clientWidth,
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
    expect(over.list).toBe(0);
    expect(over.page).toBe(0);
  });

  test("狭いホストでは、カードを縦に積む", async ({ page }) => {
    // 横に並べる余地が無いので、店名・住所・バッジを積んだまま読ませる。
    await page.setViewportSize({ width: 420, height: 900 });
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    const card = await shopCards(app).first().boundingBox();
    expect(card!.height).toBeGreaterThan(90);
  });
});

test.describe("まわる店（順路）", () => {
  test("積んでいないうちは、空の枠を出さない", async ({ page }) => {
    // 空の枠は「まだ置かれていない場所」に見えて、操作できる何かだと誤解される。
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);
    await expect(app.getByRole("region", { name: "まわる店" })).toHaveCount(0);
  });

  test("選んだ店を足すと、回る順番と距離が出る", async ({ page }) => {
    const app = await callTool(page, "find-nearby-iekei-ramen", {
      lat: 35.4657,
      lon: 139.622,
      label: "横浜駅",
      source: "place",
      limit: 5,
    });
    await waitForApp(app);

    // 遠い方から先に足して、並べ替えが効くことを見る。
    await shopCards(app).nth(2).click();
    const third = await shopName(shopCards(app).nth(2));
    await app.getByRole("button", { name: "まわる店に追加" }).click();

    await shopCards(app).nth(0).click();
    const first = await shopName(shopCards(app).nth(0));
    await app.getByRole("button", { name: "まわる店に追加" }).click();

    const route = app.getByRole("region", { name: "まわる店" });
    await expect(route).toBeVisible();
    await expect(route.getByRole("heading", { name: "まわる店（2 / 3 軒）" })).toBeVisible();

    // 足した順ではなく、近い順に並べ替わっている。
    const items = route.locator("ol > li");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText(first);
    await expect(items.nth(1)).toContainText(third);
    // 1 軒目は基準地点から測る。
    await expect(items.nth(0)).toContainText("横浜駅から");
    await expect(items.nth(1)).toContainText("1 軒目から");
    await expect(route.getByText(/合計 .*（出発点からの直線距離）/)).toBeVisible();

    /*
     * 渡せる先は Google だけ。Apple の URL には経由地が無く、1 軒目までしか
     * 渡せないので「まわる店」の用を成さない（ボタンごと外した）。
     */
    await expect(route.getByRole("button", { name: "Google マップで開く" })).toBeVisible();
    await expect(route.getByRole("button", { name: /Apple/ })).toHaveCount(0);
  });

  test("検索し直しても、順路の出発点を落とさない", async ({ page }) => {
    /*
     * 入れた店は検索をまたいで残るのに、出発点だけ今の payload から取っていると、
     * 基準地点を持たないモード（検索フォーム・地図）へ移った瞬間に出発点が消える。
     * 順路が並べ替わり、1 軒目の距離が消え、地図アプリにも現在地から引かせる
     * ことになる——ユーザーは何も操作していないのに。
     */
    const app = await callTool(page, "find-nearby-iekei-ramen", {
      lat: 35.4657,
      lon: 139.622,
      label: "横浜駅",
      source: "place",
      limit: 5,
    });
    await waitForApp(app);
    for (const i of [2, 0]) {
      await shopCards(app).nth(i).click();
      await app.getByRole("button", { name: "まわる店に追加" }).click();
    }

    const route = app.getByRole("region", { name: "まわる店" });
    const order = await route.locator("ol > li").allInnerTexts();
    const total = await route.getByText(/合計/).innerText();
    expect(total).toContain("出発点からの直線距離");

    // 基準地点を持たないモードへ移る。
    await app.getByRole("tab", { name: "検索フォーム" }).click();
    await expect(app.getByRole("heading", { name: "全国の家系ラーメン" })).toBeVisible();

    await expect(route.locator("ol > li")).toHaveCount(2);
    expect(await route.locator("ol > li").allInnerTexts()).toEqual(order);
    await expect(route.getByText(/横浜駅から/)).toBeVisible();
    expect(await route.getByText(/合計/).innerText()).toBe(total);
  });

  test("あとから足した店の検索条件で、組んだ旅程を書き換えない", async ({ page }) => {
    /*
     * 出発点の無い旅程に、別の場所で探した店を足したとき。そこで基準地点を
     * 拾ってしまうと、1 軒目が押し出されて順番も距離も変わる。出発点は
     * 「空から 1 軒目」の瞬間にだけ決める。
     */
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);
    await shopCards(app).nth(0).click();
    const first = await shopName(shopCards(app).nth(0));
    await app.getByRole("button", { name: "まわる店に追加" }).click();

    const route = app.getByRole("region", { name: "まわる店" });
    await expect(route.getByText("ここから出発")).toBeVisible();

    // 基準地点のあるモードへ移り、そこで見つけた店を足す。
    await app.getByRole("tab", { name: "現在地から探す" }).click();
    await app.locator("#place").fill("横浜駅");
    await app.getByRole("button", { name: "この場所で探す" }).click();
    await expect(app.getByText("基準: 横浜駅")).toBeVisible();
    await shopCards(app).nth(0).click();
    await app.getByRole("button", { name: "まわる店に追加" }).click();

    await expect(route.locator("ol > li")).toHaveCount(2);
    // 1 軒目は動かず、出発点も後付けされない。
    await expect(route.locator("ol > li").nth(0)).toContainText(first);
    await expect(route.getByText("ここから出発")).toBeVisible();
    await expect(route.getByText(/横浜駅から/)).toHaveCount(0);
  });

  test("1 軒だけなら、もう 1 軒足すよう促す", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);
    await shopCards(app).nth(0).click();
    await app.getByRole("button", { name: "まわる店に追加" }).click();

    const route = app.getByRole("region", { name: "まわる店" });
    await expect(route.getByText("もう 1 軒足すと、回る順番と距離が出ます。")).toBeVisible();
    // 合計距離は出さない。1 軒では測るものが無い。
    await expect(route.getByText(/合計/)).toHaveCount(0);
  });

  test("上限に達したら、足せない理由を画面に出す", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);

    for (const i of [0, 1, 2]) {
      await shopCards(app).nth(i).click();
      await app.getByRole("button", { name: "まわる店に追加" }).click();
    }

    await shopCards(app).nth(3).click();
    await expect(app.getByRole("button", { name: "まわる店に追加" })).toBeDisabled();
    // title だけだとタッチ端末で読めないので、本文にも出す。
    await expect(
      app.getByText("「まわる店」は 3 軒までです。外してから追加してください。"),
    ).toBeVisible();
  });

  test("検索し直しても、積んだ店は残る", async ({ page }) => {
    /*
     * 別の条件で見つけた店を足していくものなので、検索のたびに空にすると
     * 組み立てられない。選択（1 軒）とは寿命が違う。
     */
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);
    await shopCards(app).nth(0).click();
    const kept = await shopName(shopCards(app).nth(0));
    await app.getByRole("button", { name: "まわる店に追加" }).click();

    await app.locator("#pref").selectOption("東京都");
    await app.getByRole("button", { name: "検索" }).click();
    await expect(app.getByRole("heading", { name: "東京都の家系ラーメン" })).toBeVisible();

    const route = app.getByRole("region", { name: "まわる店" });
    await expect(route).toBeVisible();
    await expect(route.locator("ol > li").nth(0)).toContainText(kept);
  });

  test("外すと消え、すべて外すと枠ごと消える", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);
    for (const i of [0, 1]) {
      await shopCards(app).nth(i).click();
      await app.getByRole("button", { name: "まわる店に追加" }).click();
    }

    const route = app.getByRole("region", { name: "まわる店" });
    await expect(route.locator("ol > li")).toHaveCount(2);

    await route
      .locator("ol > li")
      .nth(0)
      .getByRole("button", { name: /をまわる店から外す/ })
      .click();
    await expect(route.locator("ol > li")).toHaveCount(1);

    await route.getByRole("button", { name: "すべて外す" }).click();
    await expect(app.getByRole("region", { name: "まわる店" })).toHaveCount(0);
  });

  test("入れた店のボタンは「外す」に変わる", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
    await waitForApp(app);
    await shopCards(app).nth(0).click();
    await app.getByRole("button", { name: "まわる店に追加" }).click();
    // 選び直しても、入っていることが分かる。
    // 順路側の「◯◯をまわる店から外す」と紛れるので、完全一致で取る。
    await expect(app.getByRole("button", { name: "まわる店から外す", exact: true })).toBeVisible();
  });

  test("地図モードでは順路の線と番号を描く", async ({ page }) => {
    const app = await callTool(page, "show-iekei-ramen-map", { prefecture: "神奈川県" });
    await waitForApp(app);

    for (const i of [0, 1]) {
      await shopCards(app).nth(i).click();
      await app.getByRole("button", { name: "まわる店に追加" }).click();
    }

    // 破線は「道のりではない」ことを見た目でも示すためのもの。
    const line = app.locator("svg path[stroke-dasharray]");
    await expect(line).toHaveCount(1);
    await expect(line).toHaveAttribute("stroke-dasharray", "6 6");
    // 番号のピンは順路の軒数だけ出る。
    const pins = app.locator(".route-pin");
    await expect(pins).toHaveCount(2);
    /*
     * **番号は選択中のピンより上。** 選んだ店はそのまま順路に入ることが多く、
     * 下に潜ると何軒目か読めなくなる（選択中のピンを塊より上へ出したときに、
     * 番号が巻き添えで下がった）。
     *
     * 番号は `interactive: false`＝`pointer-events: none` なので、
     * **elementFromPoint では測れない**（当たり判定から外れて下の要素が返る）。
     * 置かれているペインと、その重なり順で見る。
     */
    await expect(pins.first().locator("xpath=..")).toHaveClass(/leaflet-routeOrder-pane/);
    const zIndexOf = (pane: string) =>
      app.locator(`.leaflet-${pane}-pane`).evaluate((el) => Number(getComputedStyle(el).zIndex));
    expect(await zIndexOf("routeOrder")).toBeGreaterThan(await zIndexOf("selectedShop"));
    /*
     * 直前に選んだ店へズームしたままだと、足した順路が地図の外に出て、
     * 線を引いても見えない。順路の全体が入るところまで寄せ直す。
     *
     * toBeInViewport はブラウザの表示領域を測るもので、地図の枠内かは
     * 見ていない（アプリが縦に長いと、地図ごと画面外でも通ってしまう）。
     * 地図とピンの矩形を直接比べる。
     */
    // 寄せ直しはアニメーションで動くので、落ち着くまで測り直す。
    await expect
      .poll(async () => {
        const box = await app.locator("div[role=application]").boundingBox();
        const shown = await Promise.all([0, 1].map((i) => pins.nth(i).boundingBox()));
        if (!box || shown.some((p) => p === null)) return false;
        return shown.every(
          (p) =>
            p!.x >= box.x &&
            p!.x + p!.width <= box.x + box.width &&
            p!.y >= box.y &&
            p!.y + p!.height <= box.y + box.height,
        );
      })
      .toBe(true);
  });
});

test.describe("画面端の余白", () => {
  /**
   * セーフエリアはアプリの余白に「足す」もので、置き換えではない。
   *
   * ChatGPT は desktop でも 4 辺 0 を送ってくるので、インラインで padding を
   * 書くと余白がまるごと消える（Claude は safeAreaInsets ごと送ってこないため
   * 気付けなかった）。CSS 変数で渡し、`.main` 側で calc で足している。
   */
  test("ホストが 0 を送っても余白は残り、ノッチぶんは足される", async ({ page }) => {
    const app = await callTool(page, "search-iekei-ramen");
    await waitForApp(app);
    const main = app.locator("main");

    const paddingOf = (side: "Left" | "Top") =>
      main.evaluate((el, s) => getComputedStyle(el).getPropertyValue(`padding-${s}`), side);

    const setInset = (value: string) =>
      main.evaluate((el, v) => {
        el.style.setProperty("--safe-area-left", v);
        el.style.setProperty("--safe-area-top", v);
      }, value);

    // 4 辺 0 のホスト（ChatGPT）でも --space-4 が残る
    await setInset("0px");
    expect(await paddingOf("Left")).toBe("16px");
    expect(await paddingOf("Top")).toBe("16px");

    // ノッチのあるホストでは、その寸法だけ外へ広がる
    await setInset("8px");
    expect(await paddingOf("Left")).toBe("24px");
    expect(await paddingOf("Top")).toBe("24px");
  });
});

test.describe("地図を広げる", () => {
  /**
   * 枠の中の 24rem では、東京 162 件が重なる範囲を読めない。
   * ホストに全画面を頼み、**返ってきたモードに合わせて**枠を伸ばす。
   */
  test("全画面にすると地図が高くなり、押し戻すと元に戻る", async ({ page }) => {
    const app = await callTool(page, "show-iekei-ramen-map", { prefecture: "神奈川県" });
    await waitForApp(app);
    const map = app.locator("div[role=application]");

    const heightOf = async () => (await map.boundingBox())!.height;
    const inline = await heightOf();

    await app.getByRole("button", { name: "地図を広げる" }).click();
    const shrink = app.getByRole("button", { name: "元の大きさに戻す" });
    await expect(shrink).toBeVisible();
    // 伸びるのはホストの枠なので、落ち着くまで測り直す。
    await expect.poll(heightOf).toBeGreaterThan(inline);

    await shrink.click();
    await expect(app.getByRole("button", { name: "地図を広げる" })).toBeVisible();
    await expect.poll(heightOf).toBe(inline);
  });
});

test.describe("基準地点が店の邪魔をしないこと", () => {
  /**
   * 基準地点の印と店のピンが同じ場所に来ることはある（その店の名前で地点を
   * 調べたときなど）。**印が上に乗って押せなくなると、その店は選べない。**
   * レイヤーを作る順番では重なり順は決まらない（Leaflet は同じ SVG に描く）。
   */
  test("基準地点と重なっても、店のピンが手前に出る", async ({ page }) => {
    // たかさご家の座標をそのまま基準地点にする。
    const app = await callTool(page, "show-iekei-ramen-map", {
      // その 1 軒だけを囲む枠。塊にならず、単独のピンとして出る。
      bounds: { north: 35.441053, south: 35.440053, east: 139.629659, west: 139.628659 },
      lat: 35.440553,
      lon: 139.629159,
      label: "たかさご家",
      source: "place",
    });
    await waitForApp(app);

    const pin = app.locator('path[aria-label^="たかさご家"]');
    await expect(pin).toHaveCount(1);

    /*
     * **その位置で手前に出ているのは誰か**を見る。
     *
     * elementFromPoint はその文書の表示域だけを見るので、枠の外に出ている
     * ピンでは null が返る。先に表示域へ入れてから測ること（それに気付かず
     * 「手前に出ている」つもりの検査を書いていた）。
     *
     * 実際に押す形にもしてみたが、**ホストの版面によってピンが枠の外に出ると
     * 当たらず、CI だけで落ちた。** 押せるかどうかではなく、重なり順そのものを
     * 見る方が環境に左右されない。
     */
    expect(
      await pin.evaluate((el) => {
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return hit?.getAttribute("aria-label") ?? null;
      }),
    ).toMatch(/^たかさご家/);
  });
});

test.describe("全画面からの戻り道", () => {
  /**
   * 畳む釦は地図モードにしか無い。全画面のまま別のタブへ移ると釦ごと消え、
   * **ホストは全画面のままなのにアプリ内から戻せなくなる。**
   */
  test("地図から離れたら全画面を畳む", async ({ page }) => {
    const app = await callTool(page, "show-iekei-ramen-map");
    await waitForApp(app);
    /*
     * **枠の高さでは測れない。** 高さはモードごとの中身で決まるので、
     * 検索フォーム（長い一覧）のふつうの高さが、地図の全画面より高いことすらある。
     * ホストが全画面のときに付ける印を見る。
     */
    const panel = page.locator("iframe").first().locator("xpath=..");
    const isFullscreen = () => panel.evaluate((el) => el.className.includes("fullscreen"));

    await app.getByRole("button", { name: "地図を広げる" }).click();
    await expect.poll(isFullscreen).toBe(true);

    // 地図を離れる。ここで戻さないと、出られなくなる。
    await app.getByRole("tab", { name: "検索フォーム" }).click();

    await expect.poll(isFullscreen).toBe(false);
  });
});

test.describe("地図の塊", () => {
  /**
   * 東京 162 件・神奈川 121 件が重なると、何軒あるのかも、どれを押している
   * のかも分からない。近すぎる店はまとめ、件数を出す。
   */
  test("引いていると塊にまとまり、押すと寄って解ける", async ({ page }) => {
    const app = await callTool(page, "show-iekei-ramen-map");
    await waitForApp(app);
    const clusters = app.locator(".cluster-pin");

    // 全国を見ている状態では、単独のピンより塊のほうが多い。
    await expect.poll(() => clusters.count()).toBeGreaterThan(0);
    const biggest = clusters.first();
    const before = Number(await biggest.textContent());
    expect(before).toBeGreaterThan(1);

    // 押した塊の中身が画面いっぱいに広がるので、その塊は解ける。
    await biggest.click();
    await expect
      .poll(async () => {
        const counts = await clusters.allTextContents();
        return Math.max(0, ...counts.map(Number));
      })
      .toBeLessThan(before);
  });
});

test.describe("選んだ店が塊に隠れないこと", () => {
  /**
   * 塊（divIcon）は markerPane、店のピン（circleMarker）は overlayPane に載る。
   * 別のペインなので bringToFront では追い越せず、**選んだ店が 36px の塊に
   * 覆われて見えなくなる**。実測で、選んだ 1 軒と残りの塊の中心が 0.4〜3.3px
   * （zoom 12〜15）まで近づく組があった。
   */
  test("塊と重なっても、選択中のピンが手前に出る", async ({ page }) => {
    // 横浜・曙町あたりの 6 軒。引くと塊になり、その中心が先頭の店に重なる。
    const app = await callTool(page, "show-iekei-ramen-map", {
      bounds: { north: 35.4461, south: 35.4356, east: 139.6338, west: 139.6236 },
    });
    await waitForApp(app);

    await shopCards(app).first().click();
    const pin = app.locator('path[stroke="#141312"]');
    await expect(pin).toBeVisible();

    /** 選択中のピンの中心が塊に覆われているか、その位置で手前に出ているか。 */
    const inspect = () =>
      pin.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const x = r.x + r.width / 2;
        const y = r.y + r.height / 2;
        const covered = [...document.querySelectorAll(".cluster-pin")].some((c) => {
          const b = c.getBoundingClientRect();
          return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
        });
        return { covered, topIsPin: document.elementFromPoint(x, y) === el };
      });

    // 重なる状態になるまで引く。塊が離れていては、この検査に意味が無い。
    let state = await inspect();
    for (let i = 0; i < 5 && !state.covered; i++) {
      await app.locator(".leaflet-control-zoom-out").click();
      await page.waitForTimeout(400);
      state = await inspect();
    }

    // 前提（重なっていること）も検査に含める。満たせないなら落とす。
    expect(state.covered).toBe(true);
    expect(state.topIsPin).toBe(true);
  });
});

test.describe("塊の中身に行き着けること", () => {
  /**
   * **寄れば解ける、とは限らない。** 実データには 5.2m しか離れていない 2 軒が
   * あり（ろくの家 / 稲和家ラーメン）、地図の最大ズーム 19 でも 21.1px しか
   * 離れない＝まとめる下限 36px を下回ったまま。寄せるだけの逃げ道しか無いと、
   * その 2 軒は地図から永久に選べない。
   */
  test("キーボードだけでも、単独のピンから店を選べる", async ({ page }) => {
    /*
     * 塊だけ押せても足りない。**一覧は 20 件で切れる**ので、単独のピンが
     * その店への唯一の入口になることがある。円（SVG の path）は既定では
     * tabindex も Enter も持たない。
     */
    const app = await callTool(page, "show-iekei-ramen-map", { prefecture: "神奈川県" });
    await waitForApp(app);

    const pin = app.locator(".leaflet-overlay-pane path[role=button]").first();
    await expect(pin).toHaveAttribute("tabindex", "0");
    const label = await pin.getAttribute("aria-label");
    expect(label).toMatch(/（(直系・濃厚|クリーミー|チェーン・万人向け|情報なし)）$/);

    await pin.focus();
    await page.keyboard.press("Enter");

    // 選べた＝詳細と行き先が出る。
    await expect(app.getByRole("button", { name: "まわる店に追加" })).toBeVisible();

    /*
     * **焦点が地図に残ること。** 選ぶと印を描き直すので、押していた要素ごと
     * 消える。ブラウザは焦点を引き継がないため body へ落ち、次の Tab が画面の
     * 先頭から始まる（実測: activeElement が BODY になっていた）。
     */
    await expect
      .poll(() =>
        app
          .locator("body")
          .evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null),
      )
      .toBe(label);
  });

  test("キーボードだけでも塊を開ける", async ({ page }) => {
    /*
     * **一覧では代わりにならない。** 地図モードの一覧は 20 件で切れるので、
     * 塊を開けないと大半の店に辿り着けない。数字だけの丸は読み上げでも
     * 「12」としか聞こえないため、件数で名乗らせる。
     */
    const app = await callTool(page, "show-iekei-ramen-map");
    await waitForApp(app);
    const cluster = app.locator(".cluster-pin").first();
    const size = Number(await cluster.textContent());

    await expect(cluster).toHaveAttribute("aria-label", `この地点の ${size} 軒を開く`);
    await expect(cluster).toHaveAttribute("tabindex", "0");

    await cluster.focus();
    await page.keyboard.press("Enter");

    await expect(app.getByText(`この地点の ${size} 軒`, { exact: false })).toBeVisible();

    /*
     * **焦点が出したばかりの一覧へ移ること。** 開くと地図が寄って塊ごと
     * 描き直されるので、押していた要素は消える。body に落ちると次の Tab が
     * 画面の先頭から始まり、開いた中身へ辿り着けない。
     */
    await expect
      .poll(() =>
        app.locator("body").evaluate(() => {
          const el = document.activeElement;
          // **body を外すこと。** body の textContent には画面中の文字が入るので、
          // 焦点が落ちていても「この地点の」に一致してしまう（最初それで通していた）。
          return !el || el.tagName === "BODY" ? null : (el.textContent?.slice(0, 20) ?? null);
        }),
      )
      .toContain("この地点の");
  });

  test("塊を押すと中身が一覧に出て、そこから選べる", async ({ page }) => {
    const app = await callTool(page, "show-iekei-ramen-map");
    await waitForApp(app);

    const cluster = app.locator(".cluster-pin").first();
    const size = Number(await cluster.textContent());
    await cluster.click();

    // 押した塊の中身だけが一覧に出る（上限 20 件）。
    await expect(app.getByText(`この地点の ${size} 軒`, { exact: false })).toBeVisible();
    await expect.poll(() => shopCards(app).count()).toBe(Math.min(size, 20));

    // そこから選べる＝地図に出ていても行き先がある。
    await shopCards(app).first().click();
    await expect(app.getByRole("button", { name: "まわる店に追加" })).toBeVisible();

    // 元の一覧にも戻せる。
    await app.getByRole("button", { name: "すべて表示" }).click();
    await expect.poll(() => shopCards(app).count()).toBe(20);
  });
});

test.describe("この範囲で探す", () => {
  /**
   * 地図を別の街へ動かしても、出ている店は最初の検索結果のままだった。
   * 見ている範囲をサーバーへ渡して、そこにある店に入れ替える。
   */
  test("寄せた範囲の件数に入れ替わり、もう一度押しても変わらない", async ({ page }) => {
    const app = await callTool(page, "show-iekei-ramen-map");
    await waitForApp(app);
    const count = async () => {
      const text = await app
        .getByText(/\d+ 件/)
        .first()
        .textContent();
      return Number((text ?? "").replace(/\D/g, ""));
    };
    const search = app.getByRole("button", { name: "この範囲で探す" });

    const whole = await count();
    expect(whole).toBeGreaterThan(500);
    await expect(app.getByRole("heading", { name: "全国の家系ラーメン" })).toBeVisible();

    // 塊を押すと、その中身が画面いっぱいになるまで寄る。
    await app.locator(".cluster-pin").first().click();
    await search.click();
    await expect.poll(count).toBeLessThan(whole);
    /*
     * 見出しも範囲を名乗る。**「全国の家系ラーメン 489 件」と出ていた。**
     * サーバーがモデルへ渡す文だけ直しても、画面に嘘が残る。
     */
    await expect(
      app.getByRole("heading", { name: "地図に出ている範囲の家系ラーメン" }),
    ).toBeVisible();

    /*
     * もう一度押しても件数が変わらないこと＝**寄せ直していない**こと。
     * 結果の全体へ寄せ直すと枠が縮み、端の店が次の範囲から外れて減っていく。
     * ユーザーが自分で決めた画角を勝手に詰めない、の実測になる。
     */
    const area = await count();
    await search.click();
    await expect.poll(count).toBe(area);
  });
});

test.describe("隣の世界まで動かしたとき", () => {
  /**
   * Leaflet は世界を横に繰り返して描く。隣の複製まで動かすと経度が 480〜510 の
   * ようになるので、両端を 180 に丸めると**日本が画面に出ているのに幅ゼロの
   * 範囲**になり、「この範囲で探す」が 0 件を返す。
   */
  test("隣の複製に動かしても、この範囲で探すが 0 件にならない", async ({ page }) => {
    const app = await callTool(page, "show-iekei-ramen-map");
    await waitForApp(app);
    const map = app.locator("div[role=application]");

    /*
     * 世界を小さくしてから、1 周を超えて引きずる。
     *
     * **整定を待つこと。** 待たずに続けて引きずると途中で呑まれ、複製まで
     * 届かない＝日本が見えたままになり、直っていなくても通ってしまう
     * （実際にそうなっていた）。ズームと慣性が止まってから次へ進む。
     */
    for (let i = 0; i < 3; i++) await app.locator(".leaflet-control-zoom-out").click();
    await page.waitForTimeout(800);
    const box = (await map.boundingBox())!;
    const y = box.y + box.height / 2;
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(box.x + box.width - 20, y);
      await page.mouse.down();
      await page.mouse.move(box.x + 20, y, { steps: 20 });
      await page.mouse.up();
      await page.waitForTimeout(400);
    }

    await app.getByRole("button", { name: "この範囲で探す" }).click();

    // 日本は見えているのだから、0 件にはならない。
    await expect
      .poll(async () => {
        const text = await app
          .getByText(/\d+ 件/)
          .first()
          .textContent();
        return Number((text ?? "").replace(/\D/g, ""));
      })
      .toBeGreaterThan(0);
  });
});

test.describe("外から来た文字の扱い", () => {
  /**
   * 基準地点の表示名は tool の引数と geocode の結果（どちらも外から来る）。
   * Leaflet は渡された文字列を **HTML として描く**ので、素通しにできない。
   */
  test("地名に markup が入っていても、文字として出す", async ({ page }) => {
    const app = await callTool(page, "find-nearby-iekei-ramen", {
      lat: 35.4657,
      lon: 139.622,
      label: '<img src=x onerror="window.__pwned=1">横浜駅',
      source: "place",
    });
    await waitForApp(app);
    await app.getByRole("tab", { name: "地図から探す" }).click();
    await expect(app.getByText(/直線距離 500m と 1km/)).toBeVisible();

    /*
     * 基準地点の印にカーソルが乗るとツールチップが開く。印は 5px と小さく、
     * 同心円や店のピンと重なって hover の当たり判定を取りづらいので、
     * イベントを直接送る。
     */
    await app.locator('path[fill="#1f6f4a"]').dispatchEvent("mouseover");
    const tip = app.locator(".leaflet-tooltip");
    await expect(tip).toBeVisible();

    // 中身は文字。img が生えていない＝HTML として解釈されていない。
    await expect(tip).toContainText("<img");
    expect(await tip.locator("img").count()).toBe(0);
  });
});

test.describe("範囲と他の条件の両立", () => {
  /**
   * 「この範囲で探す」のあと味を変えると、範囲が落ちて全国に戻っていた。
   * 味は「どこ」ではなく「何」なので、範囲は保たれるべき。
   */
  test("都道府県と範囲の両方が来ていても、味を変えて範囲を失わない", async ({ page }) => {
    /*
     * モデルは `show-iekei-ramen-map` を両方付きで呼べる（スキーマも payload も
     * 両方を持てる）。「都道府県が入っていたら範囲を捨てる」と決め打つと、
     * この状態で味を変えただけで県全体に広がる。
     */
    const app = await callTool(page, "show-iekei-ramen-map", {
      prefecture: "神奈川県",
      bounds: { north: 35.52, south: 35.42, east: 139.68, west: 139.58 },
    });
    await waitForApp(app);
    const count = async () => {
      const text = await app
        .getByText(/\d+ 件/)
        .first()
        .textContent();
      return Number((text ?? "").replace(/\D/g, ""));
    };

    expect(await count()).toBe(32);

    await app.getByRole("button", { name: "直系・濃厚", exact: true }).click();

    // 枠の中の 4 件。範囲を落とすと県全体の 6 件になる。
    await expect.poll(count).toBe(4);
    await expect(
      app.getByRole("heading", { name: "地図に出ている範囲の家系ラーメン" }),
    ).toBeVisible();

    // 逆に、都道府県を**変えた**ら範囲は捨てる。「どこ」の言い直しだから。
    await app.locator("#pref").selectOption("東京都");
    await expect(app.getByRole("heading", { name: "東京都の家系ラーメン" })).toBeVisible();
  });

  test("範囲検索の応答を待つ間に味を変えても、範囲は失われない", async ({ page }) => {
    /*
     * 「この範囲で探す」の応答が返る前に味を変えると、そのときの payload には
     * まだ範囲が入っていない。payload だけを見ていると、2 本目が全国検索に
     * なり、**あとから返った方が勝つ**ので範囲の結果が捨てられる。
     */
    await page.route("**/mcp", async (route) => {
      // 範囲つきの呼び出しだけ遅らせて、追い越しを起こす。
      if ((route.request().postData() ?? "").includes('"bounds"')) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await route.continue();
    });

    const app = await callTool(page, "show-iekei-ramen-map");
    await waitForApp(app);

    await app.locator(".cluster-pin").first().click();
    await app.getByRole("button", { name: "この範囲で探す" }).click();
    // 応答を待たずに味を変える。
    await app.getByRole("button", { name: "直系・濃厚", exact: true }).click();

    await expect(
      app.getByRole("heading", { name: "地図に出ている範囲の家系ラーメン" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("範囲検索の応答を待つ間に味を変えても、都道府県は戻らない", async ({ page }) => {
    /*
     * 「この範囲で探す」は都道府県を空にして呼ぶが、画面のプルダウンは応答が
     * 返るまで前の県を指したままになる。そこで味を変えると、2 本目が県を
     * 付け直して走り、**枠が県境をまたいでいた場合に黙って県内へ絞り直される**。
     */
    await page.route("**/mcp", async (route) => {
      if ((route.request().postData() ?? "").includes('"bounds"')) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await route.continue();
    });

    const app = await callTool(page, "show-iekei-ramen-map", { prefecture: "神奈川県" });
    await waitForApp(app);
    await expect(app.locator("#pref")).toHaveValue("神奈川県");

    await app.locator(".cluster-pin").first().click();
    await app.getByRole("button", { name: "この範囲で探す" }).click();
    await app.getByRole("button", { name: "直系・濃厚", exact: true }).click();

    await expect(
      app.getByRole("heading", { name: "地図に出ている範囲の家系ラーメン" }),
    ).toBeVisible({ timeout: 15_000 });
    // 枠が「どこ」を言い直したのだから、県は外れたままであること。
    await expect(app.locator("#pref")).toHaveValue("");
  });

  test("地図タブを押し直しても範囲は保たれる", async ({ page }) => {
    /*
     * いま居るタブをもう一度押すのは「入り直し」ではない（「迷ったら」で
     * キーワードを保つのと同じ扱い）。ここで範囲が落ちると、押しただけで
     * 母数が全国に広がり、理由が画面に残らない。
     */
    const app = await callTool(page, "show-iekei-ramen-map");
    await waitForApp(app);

    await app.locator(".cluster-pin").first().click();
    await app.getByRole("button", { name: "この範囲で探す" }).click();
    await expect(
      app.getByRole("heading", { name: "地図に出ている範囲の家系ラーメン" }),
    ).toBeVisible();

    await app.getByRole("tab", { name: "地図から探す" }).click();

    await expect(
      app.getByRole("heading", { name: "地図に出ている範囲の家系ラーメン" }),
    ).toBeVisible();
  });

  test("味を変えても範囲は保たれる", async ({ page }) => {
    const app = await callTool(page, "show-iekei-ramen-map");
    await waitForApp(app);
    const count = async () => {
      const text = await app
        .getByText(/\d+ 件/)
        .first()
        .textContent();
      return Number((text ?? "").replace(/\D/g, ""));
    };

    await app.locator(".cluster-pin").first().click();
    await app.getByRole("button", { name: "この範囲で探す" }).click();
    const area = await count();
    expect(area).toBeLessThan(558);

    // 味のチップは押した瞬間に呼び直す。
    await app.getByRole("button", { name: "直系・濃厚", exact: true }).click();

    // 見出しも件数も、範囲のまま。
    await expect(
      app.getByRole("heading", { name: "地図に出ている範囲の家系ラーメン" }),
    ).toBeVisible();
    await expect.poll(count).toBeLessThanOrEqual(area);
  });
});

test.describe("まわる店と範囲の両立", () => {
  /**
   * 積んだ店がある状態で「この範囲で探す」を押すと、地図が作り直される。
   * このとき順路の節が寄せ直すと、**画面の見出しと結果は範囲のものなのに、
   * 地図だけ順路へ飛ぶ。** その状態でもう一度押すと、見当違いの場所を探す。
   */
  test("1 軒目を積んだときも、出発点ごと順路の全体へ寄せる", async ({ page }) => {
    /*
     * 地図を開いた時点では順路が空なので、そこで「作り直しの 1 回目」を
     * 記録しそこねると、**最初の 1 軒を積んだときが 1 回目と誤解されて
     * 寄せ直しが飛ぶ**。出発点が遠いと、順路の大半が画面の外に残る。
     */
    const app = await callTool(page, "find-nearby-iekei-ramen", {
      lat: 35.4657,
      lon: 139.622,
      label: "横浜駅",
      source: "place",
    });
    await waitForApp(app);
    await app.getByRole("tab", { name: "地図から探す" }).click();
    await expect(app.getByText(/直線距離 500m と 1km/)).toBeVisible();

    // 一覧の先頭は愛知県の店。横浜から 250km ほど離れている。
    await shopCards(app).first().click();
    await app.getByRole("button", { name: "まわる店に追加" }).click();

    // 出発点の印が地図の枠に入っていること＝順路の全体へ寄せていること。
    await expect
      .poll(async () => {
        const box = await app.locator("div[role=application]").boundingBox();
        const origin = await app.locator('path[fill="#1f6f4a"]').boundingBox();
        if (!box || !origin) return false;
        return (
          origin.x >= box.x &&
          origin.x + origin.width <= box.x + box.width &&
          origin.y >= box.y &&
          origin.y + origin.height <= box.y + box.height
        );
      })
      .toBe(true);
  });

  test("条件を変えたら、古い順路ではなく新しい結果へ寄せる", async ({ page }) => {
    /*
     * 積んだ店があるまま条件を変えると、地図が作り直される。このとき順路の節が
     * 寄せ直すと、**結果は入れ替わっているのに地図だけ古い順路へ飛ぶ**。
     * 順路は変わっていないのだから、寄せる理由が無い。
     */
    const app = await callTool(page, "show-iekei-ramen-map");
    await waitForApp(app);
    const count = async () => {
      const text = await app
        .getByText(/\d+ 件/)
        .first()
        .textContent();
      return Number((text ?? "").replace(/\D/g, ""));
    };

    // 一覧の先頭（愛知県）を積む。ここで地図はその 1 軒へ寄る。
    await shopCards(app).first().click();
    await app.getByRole("button", { name: "まわる店に追加" }).click();
    await expect(app.getByRole("button", { name: "まわる店から外す" }).first()).toBeVisible();

    // 条件を変えて結果を入れ替える（範囲は付かないので、結果の全体へ寄るはず）。
    await app.getByRole("button", { name: "直系・濃厚", exact: true }).click();
    // 全国の直系・濃厚は 17 件（関東 4 県に散っている）。
    await expect.poll(count).toBe(17);

    /*
     * 結果の全体が見えているなら、その範囲で探しても件数は変わらない。
     * 古い順路へ飛んでいると、見えているのは 1 軒の周りだけなので激減する。
     */
    await app.getByRole("button", { name: "この範囲で探す" }).click();
    await expect.poll(count).toBe(17);
  });

  test("積んだ店があっても、範囲で探した画角が動かない", async ({ page }) => {
    const app = await callTool(page, "show-iekei-ramen-map");
    await waitForApp(app);
    const count = async () => {
      const text = await app
        .getByText(/\d+ 件/)
        .first()
        .textContent();
      return Number((text ?? "").replace(/\D/g, ""));
    };
    const search = app.getByRole("button", { name: "この範囲で探す" });

    // 1 軒積む。ここで地図は順路（その 1 軒）へ寄る。
    await shopCards(app).first().click();
    await app.getByRole("button", { name: "まわる店に追加" }).click();
    await expect(app.getByRole("button", { name: "まわる店から外す" }).first()).toBeVisible();

    // **順路から離れた広い画角にする。** 同じ場所のままだと、飛んでも
    // 結果が変わらず、この不具合を捕まえられない。
    for (let i = 0; i < 6; i++) await app.locator(".leaflet-control-zoom-out").click();

    await search.click();
    const area = await count();
    expect(area).toBeGreaterThan(1);

    // もう一度押しても同じ範囲＝地図が順路へ飛んでいない。
    await search.click();
    await expect.poll(count).toBe(area);
  });
});

test.describe("基準地点の同心円", () => {
  /**
   * 「歩けるか」を決める材料が画面に無かった。基準地点があるときは印と、
   * 直線距離 500m / 1km の円を出す。
   */
  test("現在地から地図へ移ると、基準地点が引き継がれて円が出る", async ({ page }) => {
    const app = await callTool(page, "find-nearby-iekei-ramen", {
      lat: 35.4657,
      lon: 139.622,
      label: "横浜駅",
      source: "place",
    });
    await waitForApp(app);

    // 地図モードへ移っても、どこから見ているかは消えない。
    await app.getByRole("tab", { name: "地図から探す" }).click();
    await expect(app.getByText(/直線距離 500m と 1km/)).toBeVisible();
    // 円は 2 本（500m / 1km）。Leaflet は円も path で描く。
    await expect.poll(() => app.locator("path[stroke-dasharray='4 6']").count()).toBe(2);
  });
});
