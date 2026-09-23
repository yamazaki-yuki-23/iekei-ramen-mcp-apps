/**
 * MCP Apps の E2E。
 * 実ブラウザ・実ホスト・実 MCP サーバーを通して 3 モードを操作する。
 */
import { expect, test } from "@playwright/test";
import { appFrame, callTool, shopCards, shopName, waitForApp } from "./helpers";

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
    expect(await map.locator("svg path").count()).toBeGreaterThan(50);
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

    const map = app.getByRole("application", { name: "家系ラーメン店の地図" });
    const before = await map.locator("svg path").count();

    await app.locator("#pref").selectOption("神奈川県");
    await expect(app.getByRole("heading", { name: /神奈川県の家系ラーメン/ })).toBeVisible();

    const after = await map.locator("svg path").count();
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
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
    const pins = app.locator(".leaflet-marker-icon");
    await expect(pins).toHaveCount(2);
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
