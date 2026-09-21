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

    await expect(
      app.getByRole("heading", { name: "🍜 現在地から家系ラーメンを探す" }),
    ).toBeVisible();
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
    await expect(app.getByRole("heading", { name: "🍜 横浜駅の近くの家系ラーメン" })).toBeVisible();
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
