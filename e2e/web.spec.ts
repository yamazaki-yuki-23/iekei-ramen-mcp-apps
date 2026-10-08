import { test } from "./fixtures";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import type { AppPayload } from "../src/lib/types";
import { openMode } from "./helpers";
import { misjudgeNote } from "../src/lib/data-caveats";

const WEB_URL = "http://localhost:3134";
const cards = (page: Page) => page.locator("ul > li > button[data-shop-id]");
const ids = (page: Page) =>
  cards(page).evaluateAll((items) => items.map((el) => el.getAttribute("data-shop-id")));

test("トップからチャットの案内を開き、URLをコピーできる", async ({ page }) => {
  await page.goto(WEB_URL);
  await page.getByRole("link", { name: "チャットで使う方法" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("チャットで家系ラーメンを探す");
  await expect(page.getByLabel("MCPサーバーのURL")).toHaveValue("https://iekeiramen.com/mcp");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          document.documentElement.dataset.copied = value;
        },
      },
    });
  });
  await page.getByRole("button", { name: "URLをコピー" }).click();
  await expect(page.getByRole("status")).toHaveText("URLをコピーしました。");
  await expect(page.locator("html")).toHaveAttribute("data-copied", "https://iekeiramen.com/mcp");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("clipboard denied");
        },
      },
    });
  });
  await page.getByRole("button", { name: "URLをコピー" }).click();
  await expect(page.getByRole("status")).toContainText("手動でコピー");
  await expect(page.getByLabel("MCPサーバーのURL")).toBeFocused();
  expect(
    await page
      .getByLabel("MCPサーバーのURL")
      .evaluate((input: HTMLInputElement) =>
        input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0),
      ),
  ).toBe("https://iekeiramen.com/mcp");
});

test("SEOの地域・店名リンクから同じ検索条件でWebが開く", async ({ page, request }) => {
  for (const args of [
    { prefecture: "神奈川県" },
    { prefecture: "神奈川県", keyword: "横浜市" },
    { prefecture: "神奈川県", keyword: "吉村家" },
  ]) {
    await page.goto(`${WEB_URL}/?${new URLSearchParams(args)}`);
    await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
    await expect(page.locator("main")).toHaveAttribute("data-mode", "form");
    const result = await tool(request, "search-iekei-ramen", args);
    await expect.poll(() => ids(page)).toEqual(result.shops.map((shop) => shop.id));
    await expect(page.getByLabel("都道府県")).toHaveValue("神奈川県");
  }
});

/** 画面と同じMCPの結果を独立して取り、店IDと順序で比較する。 */
async function tool(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const response = await request.post("http://localhost:3131/mcp", {
    headers: { Accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  expect(response.status()).toBe(200);
  const body = await response.text();
  const message = body.split("\n").find((line) => line.startsWith("data: "));
  expect(message).toBeTruthy();
  return JSON.parse(message!.slice(6)).result.structuredContent as AppPayload;
}

test("Webを直接開いて検索・現在地・地図・まわる店を使える", async ({ page, context, request }) => {
  await context.grantPermissions(["geolocation"], { origin: WEB_URL });
  await context.setGeolocation({ latitude: 35.466, longitude: 139.622 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(WEB_URL);
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
  expect(page.frames()).toHaveLength(1);

  await openMode(page, "form");
  await expect(page.locator("main")).toHaveAttribute("data-pending-calls", "0");
  await page.getByLabel("キーワード").fill("吉村");
  await page.getByRole("button", { name: "発券する", exact: true }).click();
  const search = await tool(request, "search-iekei-ramen", { keyword: "吉村" });
  await expect.poll(() => ids(page)).toEqual(search.shops.map((shop) => shop.id));
  await cards(page).first().click();
  await page.getByRole("button", { name: "まわる店に追加" }).click();
  const route = page.getByRole("region", { name: "まわる店", exact: true });
  await expect(route).toContainText(search.shops[0].name);

  await openMode(page, "nearby");
  await page.getByRole("button", { name: "現在地で発券", exact: true }).click();
  const nearby = await tool(request, "find-nearby-iekei-ramen", {
    lat: 35.466,
    lon: 139.622,
    limit: 5,
    source: "precise",
  });
  await expect.poll(() => ids(page)).toEqual(nearby.shops.map((shop) => shop.id));
  await cards(page).filter({ hasNotText: search.shops[0].name }).first().click();
  await page.getByRole("button", { name: "まわる店に追加" }).click();
  await expect(route.getByRole("heading")).toHaveText("まわる店（2 / 3 軒）");
  await expect(route).toContainText("直線距離");

  // 外部地図へ実通信せず、ブラウザに渡すURLを確かめる。
  await page.evaluate(() => {
    window.open = (url) => {
      document.documentElement.dataset.openedUrl = String(url);
      return null;
    };
  });
  await route.getByRole("button", { name: "Google マップで開く" }).click();
  await expect
    .poll(() => page.locator("html").getAttribute("data-opened-url"))
    .toContain("https://www.google.com/maps/dir/");

  await openMode(page, "map");
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await page.getByLabel("都道府県").selectOption("神奈川県");
  const map = await tool(request, "show-iekei-ramen-map", { prefecture: "神奈川県" });
  // 地図の一覧は既存の仕様どおり先頭20件。全件数は見出しでも確認する。
  await expect.poll(() => ids(page)).toEqual(map.shops.slice(0, 20).map((shop) => shop.id));
  await expect(page.locator("main")).toContainText(`判定した結果の ${map.total} 軒`);
  await expect(page.getByRole("button", { name: "全画面" })).toHaveCount(0);
  await expect(route.getByRole("heading")).toHaveText("まわる店（2 / 3 軒）");
  expect(errors).toEqual([]);
});

test("Webの接続失敗を表示し、再読み込みで検索へ戻れる", async ({ page }) => {
  await page.route(`${WEB_URL}/mcp`, (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await page.goto(WEB_URL);
  await expect(
    page.getByText("接続できませんでした。ページを再読み込みしてください。", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("キーワード")).toHaveCount(0);
  await page.unroute(`${WEB_URL}/mcp`);
  await page.reload();
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
});

test("Webの地名検索は公開Nominatimへ出ず既存fixtureで解決する", async ({ page }) => {
  await page.goto(WEB_URL);
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
  await openMode(page, "nearby");
  await page.getByLabel("地名で指定").fill("横浜駅");
  await page.getByRole("button", { name: "この場所で発券" }).click();
  await expect(cards(page)).toHaveCount(5);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("横浜駅");
});

test("Webは会話・記録の未対応操作を出さず、3候補と次の候補を使える", async ({ page, request }) => {
  await page.goto(WEB_URL);
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "探し方" }).getByRole("button", { name: "行った店" }),
  ).toHaveCount(0);
  await openMode(page, "decide");
  const first = await tool(request, "decide-iekei-ramen", {});
  await expect.poll(() => ids(page)).toEqual(first.shops.map((shop) => shop.id));
  await expect(cards(page)).toHaveCount(3);
  await expect(page.getByRole("button", { name: /この \d 軒から選ぶ/ })).toHaveCount(0);
  await cards(page).first().click();
  await expect(page.getByRole("button", { name: "この店について聞く" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "行った", exact: true })).toHaveCount(0);
  // 接続案内へのリンクはWebにも出す。未対応の会話操作はアプリ本体に出さない。
  await expect(page.locator("main")).not.toContainText("チャット");
  await expect(page.getByRole("button", { name: "まわる店に追加" })).toBeVisible();
  await page.getByRole("button", { name: "次の 3 軒を見る" }).click();
  const next = await tool(request, "decide-iekei-ramen", { round: 1 });
  await expect.poll(() => ids(page)).toEqual(next.shops.map((shop) => shop.id));
  expect(next.shops.map((shop) => shop.id)).not.toEqual(first.shops.map((shop) => shop.id));
  await expect(page.locator("main")).not.toContainText("チャット");
});

test("Webの詳細から家系ではない・閉店の報告を匿名で送れる", async ({ page }) => {
  const sent: unknown[] = [];
  await page.route(`${WEB_URL}/reports`, async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ message: "受け取りました。反映は確認してからなので時間がかかります" }),
    });
  });
  await page.goto(WEB_URL);
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
  // 段階を出さない代わりに、誤りの可能性と報告の口を案内する（#144）。
  await expect(page.getByText(misjudgeNote(true))).toBeVisible();
  const firstId = await cards(page).first().getAttribute("data-shop-id");
  await cards(page).first().click();
  await page.getByText("店舗情報を報告する", { exact: true }).click();
  await page.getByRole("button", { name: "報告を送信", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "受け取りました" })).toBeVisible();
  expect(sent).toEqual([{ kind: "not-iekei", shopId: firstId }]);
  const secondId = await cards(page).nth(1).getAttribute("data-shop-id");
  await cards(page).nth(1).click();
  await page.getByText("店舗情報を報告する", { exact: true }).click();
  await page.getByLabel("報告の種類").selectOption("closed");
  await page.getByRole("button", { name: "報告を送信", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "受け取りました" })).toBeVisible();
  expect(sent[1]).toEqual({ kind: "closed", shopId: secondId });
});

test("0件でも未掲載店を報告でき、連打の理由と再送の結果を表示する", async ({ page }) => {
  const sent: unknown[] = [];
  await page.route(`${WEB_URL}/reports`, async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({
      status: sent.length === 1 ? 429 : 201,
      contentType: "application/json",
      body: JSON.stringify({
        message:
          sent.length === 1
            ? "短時間に報告が集中しています。1分後にお試しください"
            : "受け取りました。反映は確認してからなので時間がかかります",
      }),
    });
  });
  await page.goto(WEB_URL);
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
  await expect(page.getByText("お探しの家系が見つからないときは", { exact: true })).toBeVisible();
  await openMode(page, "form");
  await expect(page.locator("main")).toHaveAttribute("data-pending-calls", "0");
  await page.getByLabel("キーワード").fill("存在しない試験店0123");
  await page.getByRole("button", { name: "発券する", exact: true }).click();
  await expect(cards(page)).toHaveCount(0);
  await page.getByText("お探しの家系が見つからないときは", { exact: true }).click();
  await page.getByLabel("店名", { exact: true }).fill("<b>試験家</b>");
  await page.getByLabel("場所（駅名や住所）").fill("横浜駅");
  await page.getByRole("button", { name: "報告を送信", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("1分後");
  expect(sent[0]).toEqual({ kind: "missing", name: "<b>試験家</b>", location: "横浜駅" });
  await expect(page.locator("details b")).toHaveCount(0);
  await page.getByRole("button", { name: "報告を送信", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "受け取りました" })).toBeVisible();
  await page.getByRole("button", { name: "別の店舗を報告する", exact: true }).click();
  await expect(page.getByLabel("店名", { exact: true })).toHaveValue("");
  await page.getByLabel("店名", { exact: true }).fill("2件目の試験家");
  await page.getByLabel("場所（駅名や住所）").fill("新横浜駅");
  await page.getByRole("button", { name: "報告を送信", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "受け取りました" })).toBeVisible();
  expect(sent[2]).toEqual({ kind: "missing", name: "2件目の試験家", location: "新横浜駅" });
});

test("地図を読み込む間は「この範囲で」を押せず、地図が出たら押せる（#154）", async ({ page }) => {
  /*
   * 地図（Leaflet）は後から読む。道具の帯だけ先に出ると、地図の範囲を読めないうちに
   * 押せてしまい、押しても何も起きなかった。地図の chunk を遅らせて確かめる。
   */
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  await page.route(/\/assets\/MapView-[^/]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(WEB_URL);
  await page.getByRole("button", { name: "地図で", exact: true }).click();
  const searchArea = page.getByRole("button", { name: /この範囲で/ });
  await expect(searchArea).toBeDisabled();
  await expect(page.locator(".leaflet-container")).toHaveCount(0);
  release();
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(searchArea).toBeEnabled();
});

test("地図のファイルを読めなくても、地図の場所で知らせ、ほかの探し方は使える（#154）", async ({
  page,
}) => {
  // 先読みも含めて地図の chunk を落とす。通信の途切れを作る。
  await page.route(/\/assets\/MapView-[^/]+\.js$/, (route) => route.abort());
  await page.goto(WEB_URL);
  await page.getByRole("button", { name: "地図で", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("地図を読み込めませんでした");
  await expect(page.getByRole("button", { name: "再読み込み" })).toBeVisible();
  // アプリ全体は残り、ほかの探し方へ移れる。
  await page.getByRole("button", { name: "店名で", exact: true }).click();
  await expect(page.locator("#kw")).toBeVisible();
});
