import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { callTool, E2E_SERVER_URL, shopCards, shopId, waitForApp } from "./helpers";

test.beforeEach(async ({ page }) => {
  // 実ホストのPOSTを固定データの実MCPサーバーへ送る。応答自体はモックしない。
  // SSEのGETは継続接続なので、route.fetchで待たず通常の経路を使う。
  await page.route(E2E_SERVER_URL, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch({ url: "http://localhost:3133/mcp" });
    await route.fulfill({ response });
  });
});

test("固定fixtureの0件を検索画面で表示する", async ({ page }) => {
  const app = await callTool(page, "search-iekei-ramen", { prefecture: "秋田県" });
  await waitForApp(app);
  await expect(shopCards(app)).toHaveCount(0);
  await expect(app.getByText(/見つかりませんでした|該当する店舗/)).toBeVisible();
});

test("固定fixtureの1件では3軒の文言を表示しない", async ({ page }) => {
  const app = await callTool(page, "decide-iekei-ramen", { prefecture: "北海道" });
  await waitForApp(app);
  await expect(shopCards(app)).toHaveCount(1);
  await expect(app.getByRole("heading", { name: /迷ったらこの 1 軒/ })).toBeVisible();
  await expect(app.getByRole("button", { name: "この 1 軒について聞く" })).toBeVisible();
  await expect(app.getByRole("button", { name: /この 3 軒から選ぶ/ })).toHaveCount(0);
});

for (const { prefecture, remaining } of [
  { prefecture: "青森県", remaining: 1 },
  { prefecture: "岩手県", remaining: 2 },
]) {
  test(`固定fixtureの最終巡は${remaining}軒だけ表示し、次の巡で最初の3軒に戻る`, async ({
    page,
  }) => {
    const app = await callTool(page, "decide-iekei-ramen", { prefecture });
    await waitForApp(app);
    await expect(shopCards(app)).toHaveCount(3);
    const first = await Promise.all((await shopCards(app).all()).map(shopId));
    await app.getByRole("button", { name: "次の 3 軒を見る" }).click();
    await expect(shopCards(app)).toHaveCount(remaining);
    const last = await Promise.all((await shopCards(app).all()).map(shopId));
    expect(last.every((id) => !first.includes(id))).toBe(true);
    await expect(
      app.getByRole("heading", { name: new RegExp(`迷ったらこの ${remaining} 軒`) }),
    ).toBeVisible();
    await app.getByRole("button", { name: "最初の 3 軒に戻る" }).click();
    await expect(shopCards(app)).toHaveCount(3);
    expect(await Promise.all((await shopCards(app).all()).map(shopId))).toEqual(first);
  });
}

test("選んだピンも、判定の段階の形を保つ", async ({ page }) => {
  /*
   * 選んだピンの縁を一律に黒くすると、「家系の可能性」と「家系か未判定」が
   * 同じ形になる（形で段階を読ませる約束が、選んだ店でだけ崩れる）。
   * 固定fixtureの山形県には「家系か未判定」が 1 軒だけあり、塊にならない。
   */
  const app = await callTool(page, "show-iekei-ramen-map", { prefecture: "山形県" });
  await waitForApp(app);
  const candidate = app
    .locator('.leaflet-overlay-pane path[role=button][aria-label*="（家系か未判定・"]')
    .first();
  await candidate.focus();
  await page.keyboard.press("Enter");
  const selected = app.locator(".leaflet-selectedShop-pane path[role=button]");
  await expect(selected).toHaveAttribute("aria-label", /（家系か未判定・/);
  // 未判定の細い灰の縁のまま、1px だけ太くなる。
  await expect(selected).toHaveAttribute("stroke", "#635e57");
  await expect(selected).toHaveAttribute("stroke-width", "2.5");
});
