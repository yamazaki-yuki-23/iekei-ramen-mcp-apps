/**
 * 読み込み中の見せ方（#214）。待つ間も結果の場所を空けず、届いても配置が変わらない。
 * 応答をわざと遅らせ、押してから届くまでと届いた後で、部品の位置を比べる。
 */
import { expect, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { callTool, E2E_SERVER_URL, waitForApp } from "./helpers";

const WEB = "http://localhost:3134";
test.use({ viewport: { width: 390, height: 844 } });

/**
 * main の上端からの位置。画面からの位置で比べると、押すときのスクロールで数 px ずれて見える
 * （会話の中で 4px。高さはどこも変わっていなかった）。
 */
const top = (locator: Locator) =>
  locator.evaluate((el) =>
    Math.round(
      el.getBoundingClientRect().top - document.querySelector("main")!.getBoundingClientRect().top,
    ),
  );
const settled = (scope: Page | FrameLocator) =>
  expect(scope.locator("main[data-pending-calls]").first()).toHaveAttribute(
    "data-pending-calls",
    "0",
  );

/** これ以降の検索の応答を ms 遅らせる。 */
async function slowDown(page: Page, url: string, ms: number) {
  await page.route(url, async (route) => {
    if (route.request().postData()?.includes('"tools/call"'))
      await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

test("Web: 次の 3 軒を待つ間も前の 3 軒を残し、下の券売機を動かさない。前の 3 軒は押せない", async ({
  page,
}) => {
  await page.goto(WEB);
  await settled(page);
  await expect(page.locator("button[data-shop-id]")).toHaveCount(3);
  const issue = page.getByRole("button", { name: /^この条件で 3 軒を出す/ });
  const before = await top(issue);
  await slowDown(page, "**/mcp", 1500);
  await page.getByRole("button", { name: /次の 3 軒/ }).click();
  // 300ms を過ぎたら薄くして「読み込み中」を 1 回伝える。前の 3 軒は残るが押せない。
  await expect(page.getByRole("status").filter({ hasText: "読み込み中…" })).toHaveCount(1);
  await expect(page.locator("button[data-shop-id]")).toHaveCount(3);
  await expect(page.locator("button[data-shop-id]:not([inert] *)")).toHaveCount(0);
  expect(await top(issue)).toBe(before);
  await settled(page);
  await expect(page.locator("button[data-shop-id]:not([inert] *)")).toHaveCount(3);
});

test("Web: 探し方を変えて待つ間は、その形の骨組みで場所を取り、届いても一覧の位置が変わらない", async ({
  page,
}) => {
  await page.goto(WEB);
  await settled(page);
  await slowDown(page, "**/mcp", 1500);
  const nav = page.getByRole("navigation", { name: "探し方" });
  await nav.getByRole("button", { name: "店名で", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "読み込み中…" })).toHaveCount(1);
  const list = page.locator("ul:has(> li > button[data-shop-id])").first();
  // 待つ間から一覧の形がある（届くのを待たずに確かめる。応答は 1.5 秒後）。
  await expect(list).toBeAttached({ timeout: 500 });
  const waiting = await top(list);
  // 件数の札は場所を先に取ってある（届いた瞬間に約 20px ずれない）。
  const tabs = await top(nav);
  await settled(page);
  await expect(page.locator("button[data-shop-id]:not([inert] *)").first()).toBeVisible();
  expect(await top(list)).toBe(waiting);
  expect(await top(nav)).toBe(tabs);
});

test("Web: 開いて結果が届いても、下の規約のリンクがずれにならない（トップの CLS）", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { shift: number };
    w.shift = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as Array<{
        value: number;
        hadRecentInput: boolean;
      }>)
        if (!e.hadRecentInput) w.shift += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(WEB);
  await settled(page);
  await expect(page.locator("button[data-shop-id]")).toHaveCount(3);
  await page.waitForTimeout(500);
  // 直す前は 0.078（接続前の短い画面で、規約のリンクが画面の中に出ていた）。
  expect(await page.evaluate(() => (window as unknown as { shift: number }).shift)).toBeLessThan(
    0.01,
  );
});

test("会話の中: 次の 3 軒を待つ間も、券売機を押し下げない", async ({ page }) => {
  const app = await callTool(page, "decide-iekei-ramen", {
    lat: 35.4658,
    lon: 139.6222,
    label: "横浜駅",
  });
  await waitForApp(app);
  const issue = app.getByRole("button", { name: /^この条件で 3 軒を出す/ });
  const before = await top(issue);
  await slowDown(page, E2E_SERVER_URL, 1500);
  await app.getByRole("button", { name: /次の 3 軒/ }).click();
  await expect(app.getByRole("status").filter({ hasText: "読み込み中…" })).toHaveCount(1);
  expect(await top(issue)).toBe(before);
  await settled(app);
  // 届いた 3 軒は住所の行数が違うことがあるので、待つ間に詰めて戻す跳ねが無いことだけを見る。
  await expect(app.locator("button[data-shop-id]:not([inert] *)")).toHaveCount(3);
});

test("家系カメラ: 店の候補を待つ間も骨組みで場所を取り、届いても下のボタンが動かない", async ({
  page,
}) => {
  await page.context().grantPermissions(["geolocation"], { origin: WEB });
  await page.context().setGeolocation({ latitude: 35.4658, longitude: 139.6222 });
  await slowDown(page, "**/mcp", 1500);
  await page.goto(`${WEB}/camera/`);
  const bytes = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 48;
    c.getContext("2d")!.fillRect(0, 0, 64, 48);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg"));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page
    .getByLabel("撮る", { exact: true })
    .setInputFiles({ name: "r.jpg", mimeType: "image/jpeg", buffer: Buffer.from(bytes) });
  await expect(page.getByRole("status").filter({ hasText: "読み込み中…" })).toHaveCount(1);
  const again = page.getByRole("button", { name: "いまいる場所で探し直す" });
  const waiting = await top(again);
  await expect(page.locator("ul li button:not([inert] *)").first()).toBeVisible({
    timeout: 20_000,
  });
  expect(await top(again)).toBe(waiting);
});

test("Web: 地図の範囲で発券し直す間は、前の結果の地図も一覧も押せない", async ({ page }) => {
  await page.goto(WEB);
  await settled(page);
  await page
    .getByRole("navigation", { name: "探し方" })
    .getByRole("button", { name: "地図で", exact: true })
    .click();
  await settled(page);
  await expect(page.locator(".maplibregl-map")).toBeVisible();
  await slowDown(page, "**/mcp", 1500);
  await page.getByRole("button", { name: /この範囲/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "読み込み中…" })).toHaveCount(1);
  // 古いピンを選ぶと、取り直しが失敗したときに選んだ店がモデルに残る（#214 のレビュー）。
  await expect(page.locator(".maplibregl-map:not([inert] *)")).toHaveCount(0);
  await expect(page.locator("button[data-shop-id]:not([inert] *)")).toHaveCount(0);
  await settled(page);
  await expect(page.locator(".maplibregl-map:not([inert] *)")).toHaveCount(1);
});

test("Web: 次の 3 軒を押しても画面を戻さず、押したボタンが上へ逃げない（オーナーの指摘）", async ({
  page,
}) => {
  await page.goto(WEB);
  await settled(page);
  await expect(page.locator("button[data-shop-id]")).toHaveCount(3);
  // 3 軒の頭が画面の上に少しはみ出るまで送る（ボタンを指で押しやすい位置）。
  await page.evaluate(() => {
    const list = document.querySelector("ul:has(> li > button[data-shop-id])")!;
    scrollTo(0, list.getBoundingClientRect().top + scrollY + 60);
  });
  const next = page.getByRole("button", { name: /次の 3 軒|最初の 3 軒/ });
  const scrollBefore = await page.evaluate(() => scrollY);
  for (let round = 0; round < 3; round++) {
    const before = await top(next);
    await slowDown(page, "**/mcp", 300);
    await next.click();
    await settled(page);
    await expect(page.locator("button[data-shop-id]:not([inert] *)")).toHaveCount(3);
    // 縮めない（店名が 2 行の食券が来て伸びることはある）。
    expect(await top(next)).toBeGreaterThanOrEqual(before);
    await page.unroute("**/mcp");
  }
  expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
});

test("Web: 「お探しの家系が見つからないときは」は、結果を待たずに出る", async ({ page }) => {
  // 結果は 5 秒後。それより前（3 秒以内）に出ていること。
  await slowDown(page, "**/mcp", 5000);
  await page.goto(WEB);
  await expect(page.getByText("お探しの家系が見つからないときは", { exact: true })).toBeVisible({
    timeout: 3000,
  });
  await expect(page.locator("button[data-shop-id]:not([inert] *)")).toHaveCount(0);
});

test("Web: つながる前から、見出し・探し方・券売機・「見つからないときは」を出す（後から差し込んで押し出さない）", async ({
  page,
}) => {
  // つながる（initialize）こと自体を遅らせる。
  await page.route("**/mcp", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto(WEB);
  // つながる間も本体を描く（押せない）。見出し・探し方・券売機・「見つからないときは」が最初から出る。
  await expect(page.locator("main[inert]")).toHaveCount(1);
  await expect(page.locator("main")).toHaveAttribute("data-pending-calls", "1");
  const nav = page.locator("nav[aria-label='探し方']");
  await expect(nav).toBeVisible();
  await expect(page.getByText("お探しの家系が見つからないときは", { exact: true })).toBeVisible();
  await expect(page.locator("button", { hasText: /^この条件で 3 軒を出す/ })).toBeVisible();
  const navTop = await nav.evaluate((el) => Math.round(el.getBoundingClientRect().top + scrollY));
  await expect(page.locator("main:not([inert])")).toHaveCount(1, { timeout: 20_000 });
  expect(await nav.evaluate((el) => Math.round(el.getBoundingClientRect().top + scrollY))).toBe(
    navTop,
  );
});

test("Web: 現在地が無く件数が来ない間は、件数の札の場所を取らない（#214 のレビュー）", async ({
  page,
}) => {
  await page.goto(WEB);
  await settled(page);
  await page
    .getByRole("navigation", { name: "探し方" })
    .getByRole("button", { name: "現在地から", exact: true })
    .click();
  await settled(page);
  // 見えない札が 1 行を取り、見出しの下に大きな空きができていた。
  await expect(page.locator("main .pending-reserve")).toHaveCount(0);
});

test("Web: 向きを変えて幅が変わったら、食券の並びの高さを測り直す（#214 のレビュー）", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(WEB);
  await settled(page);
  await expect(page.locator("button[data-shop-id]")).toHaveCount(3);
  await page.setViewportSize({ width: 700, height: 844 });
  // 広い幅では食券が低くなる。狭い幅で測った高さを下限に残さない。
  await expect
    .poll(() =>
      page.evaluate(() => {
        const list = document.querySelector<HTMLElement>("ul:has(> li > button[data-shop-id])")!;
        const min = parseFloat(getComputedStyle(list).minHeight) || 0;
        list.style.minHeight = "0";
        const natural = list.getBoundingClientRect().height;
        list.style.minHeight = "";
        return Math.round(min - natural);
      }),
    )
    .toBeLessThanOrEqual(0);
});

test("Web: つながる前の骨組みの間は、地図（Leaflet）を先読みしない（#214 のレビュー）", async ({
  page,
}) => {
  const loads: number[] = [];
  let firstResult = Infinity;
  page.on("request", (request) => {
    if (/\/assets\/MapView-[^/]+\.js$/.test(request.url())) loads.push(Date.now());
  });
  // 最初の検索の返事を 2.5 秒遅らせる。その間に地図を読み始めると、帯域を取り合う。
  await page.route("**/mcp", async (route) => {
    if (route.request().postData()?.includes('"tools/call"'))
      await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue();
  });
  page.on("response", (response) => {
    if (response.url().endsWith("/mcp") && response.request().postData()?.includes('"tools/call"'))
      firstResult = Math.min(firstResult, Date.now());
  });
  await page.goto(WEB);
  await settled(page);
  await expect.poll(() => loads.length).toBeGreaterThan(0);
  // 直す前は、つながる前の骨組みを描いた直後（返事より約 2 秒前）に読み始めていた。
  expect(loads[0]).toBeGreaterThanOrEqual(firstResult);
});

test("Web: 同じ探し方で取り直し始めても、前の食券を作り直さない（入ってくる動きをやり直さない。#214 のレビュー）", async ({
  page,
}) => {
  await page.goto(WEB);
  await settled(page);
  const first = page.locator("ul:has(> li > button[data-shop-id]) > li").first();
  await expect(first).toBeVisible();
  // 同じ要素のままかを、目印で見る（作り直されると目印が消える）。
  await first.evaluate((el) => el.setAttribute("data-kept", ""));
  await slowDown(page, "**/mcp", 1500);
  await page.getByRole("button", { name: /次の 3 軒/ }).click();
  await expect(page.locator("main")).not.toHaveAttribute("data-pending-calls", "0");
  await expect(page.locator("li[data-kept]")).toHaveCount(1);
});

test("会話の中: 0 件の結果から同じ探し方で探し直す間も、骨組みに替えない（#214 のレビュー）", async ({
  page,
}) => {
  const app = await callTool(page, "search-iekei-ramen");
  await waitForApp(app);
  await app.locator("#kw").fill("存在しない店名ZZZ");
  await app.getByRole("button", { name: "この条件で探す", exact: true }).click();
  const empty = app.getByText("条件に合う店舗が見つかりませんでした。");
  await expect(empty).toBeVisible();
  await slowDown(page, E2E_SERVER_URL, 2500);
  await app.locator("#kw").fill("存在しない店名YYY");
  await app.getByRole("button", { name: "この条件で探す", exact: true }).click();
  // 返事は 2.5 秒後。届く前（1 秒以内）に、骨組みの店が並んでいないこと。
  await expect(app.getByRole("status").filter({ hasText: "読み込み中…" })).toHaveCount(1, {
    timeout: 1000,
  });
  await expect(app.locator("ul > li > button")).toHaveCount(0, { timeout: 1000 });
  await expect(empty).toBeAttached();
  await settled(app);
});

test("Web: トップはつながる前から券売機の「近くで」が点いていて、「全国」が一瞬も点かない（#251）", async ({
  page,
}) => {
  // 最初の検索（near: "auto"）の応答を遅らせ、つながる前の骨組みを見る。
  await slowDown(page, "**/mcp", 1500);
  await page.goto(WEB);
  const where = page.getByRole("group", { name: "① どこで" });
  await expect(where.getByRole("button", { name: /^近くで/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(where.getByRole("button", { name: /^全国/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  // まだ押せない（結果がそろってから操作を許す順序は変えない）。
  await expect(page.locator("main[inert]")).toHaveCount(1);
  await settled(page);
});

test("Web: 県で開いたときは、つながる前に「近くで」を点けない（#251）", async ({ page }) => {
  await slowDown(page, "**/mcp", 1500);
  await page.goto(`${WEB}/?prefecture=${encodeURIComponent("神奈川県")}`);
  const where = page.getByRole("group", { name: "① どこで" });
  await expect(where).toBeVisible();
  await expect(where.getByRole("button", { name: /^近くで/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await settled(page);
});
