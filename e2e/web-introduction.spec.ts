import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { callTool, waitForApp } from "./helpers";

const WEB_URL = "http://localhost:3134";

test("初回は家系の3行説明を開き、次回は畳む。候補を変えても開閉は保つ", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(WEB_URL);
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
  const intro = page.locator('details[aria-label="家系とは"]');
  const summary = intro.locator(":scope > summary");
  await expect(intro).toHaveAttribute("open", "");
  await expect(intro.getByText("豚骨醤油と太めの麺が定番です。", { exact: true })).toBeVisible();
  await expect(intro.getByText("迷ったら、まず3軒から見てみよう。", { exact: true })).toBeVisible();
  await expect(intro.getByText("家系判定と味の分類は推定です。", { exact: true })).toBeVisible();
  // 最初の画面は約束と地図（#125）。位置を許可しなくても、店（塊）が地図に出る。
  await expect(page.getByText("家系がある。")).toBeVisible();
  await expect(page.getByText("家系の判定と味の傾向は推定、距離は直線距離です。")).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("data-mode", "map");
  await expect(page.getByRole("tab").first()).toHaveText("地図から探す");
  await expect(page.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".cluster-pin").first()).toBeVisible();
  // 「迷ったら」へは最初の画面の入口から入れる。
  await page.getByRole("button", { name: "迷ったら 3 軒に絞る" }).click();
  await expect(page.locator("main")).toHaveAttribute("data-mode", "decide");
  await expect(page.locator("button[data-shop-id]")).toHaveCount(3);

  await intro.getByText("直系・資本系・インスパイア系とは", { exact: true }).click();
  for (const term of ["直系", "資本系", "インスパイア系"]) {
    await expect(intro.locator("dt").filter({ hasText: term })).toBeVisible();
  }
  await intro.getByText("注文のしかた（お好み・卓上・ライス）", { exact: true }).click();
  await expect(intro.getByRole("columnheader", { name: "聞かれること" })).toBeVisible();
  await expect(intro).toContainText("お店の掲示に従ってください");

  await summary.focus();
  await summary.press("Enter");
  await expect(intro).not.toHaveAttribute("open", "");
  await summary.press("Enter");
  await expect(intro).toHaveAttribute("open", "");
  await page.getByRole("button", { name: "次の 3 軒を見る" }).click();
  await expect(page.getByText(/^\d+ 軒中 4〜6 軒目$/)).toBeVisible();
  await expect(intro).toHaveAttribute("open", "");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);

  await page.reload();
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
  await expect(intro).not.toHaveAttribute("open", "");
  await summary.click();
  await expect(intro).toHaveAttribute("open", "");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(intro).toHaveAttribute("open", "");
});

test("localStorageが使えなくても説明を畳み、候補を切り替えられる", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage unavailable", "SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(WEB_URL);
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
  const intro = page.locator('details[aria-label="家系とは"]');
  await expect(intro).toHaveAttribute("open", "");
  await intro.locator(":scope > summary").click();
  await expect(intro).not.toHaveAttribute("open", "");
  await page.getByRole("button", { name: "迷ったら 3 軒に絞る" }).click();
  await page.getByRole("button", { name: "次の 3 軒を見る" }).click();
  await expect(page.getByText(/^\d+ 軒中 4〜6 軒目$/)).toBeVisible();
  await expect(intro).not.toHaveAttribute("open", "");
  await expect(page.locator("button[data-shop-id]")).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("MCP Appsは説明を追加せず、検索フォームから始まる", async ({ page }) => {
  const app = await callTool(page, "search-iekei-ramen");
  await waitForApp(app);
  await expect(app.locator('details[aria-label="家系とは"]')).toHaveCount(0);
  await expect(app.getByRole("tab").first()).toHaveText("検索フォーム");
  await expect(app.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
});

test("接続を待つ間も約束を先に見せ、入口は押せない形で出す", async ({ page }) => {
  // /mcp の応答を遅らせる。約束はデータに依らないので、待たずに出す（#125）。
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/mcp", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(WEB_URL);
  await expect(page.getByText("読み込み中…")).toBeVisible();
  // 接続後と同じ main の中に描く（余白が揃わないと、つながった瞬間に跳ぶ）。
  await expect(page.locator("main").getByText("家系がある。")).toBeVisible();
  await expect(page.getByRole("button", { name: "地図で見る" })).toBeDisabled();
  release();
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
  await expect(page.getByRole("button", { name: "地図で見る" })).toBeEnabled();
});

test("Webの地図では、絞り込みを地図と一覧の間に置く", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(WEB_URL);
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
  const order = await page.evaluate(() => {
    const map = document.querySelector(".leaflet-container")!;
    const select = document.querySelector("select")!;
    const card = document.querySelector("button[data-shop-id]")!;
    const following = Node.DOCUMENT_POSITION_FOLLOWING;
    return {
      mapThenSelect: Boolean(map.compareDocumentPosition(select) & following),
      selectThenCard: Boolean(select.compareDocumentPosition(card) & following),
    };
  });
  // 地図 → 絞り込み → 一覧。一覧の 20 件の後ろに絞り込みを置かない。
  expect(order).toEqual({ mapThenSelect: true, selectThenCard: true });
});

test("Webの地図で条件の取得に失敗しても、絞り込みは消さない", async ({ page }) => {
  await page.goto(WEB_URL);
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
  // ここから先の検索だけ落とす。失敗した条件を変え直す口が残っていること。
  await page.route("**/mcp", async (route) => {
    const body = route.request().postData() ?? "";
    if (body.includes('"show-iekei-ramen-map"') || body.includes('"search-iekei-ramen"'))
      return route.fulfill({ status: 500, body: "fail" });
    return route.continue();
  });
  // キーボードで選んだ選択肢から焦点を落とさない（置き場所を変えると作り直されて消える）。
  await page.getByLabel("都道府県").focus();
  await page.getByLabel("都道府県").selectOption("神奈川県");
  await expect(page.locator(".leaflet-container")).toHaveCount(0);
  await expect(page.getByLabel("都道府県")).toBeVisible();
  await expect(page.getByLabel("都道府県")).toBeFocused();
  await expect(page.getByRole("button", { name: "こだわらない" })).toBeVisible();
});

test("最初の画面の入口から送った見出しは、上端に余白を残して止まる", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(WEB_URL);
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
  await page.getByRole("button", { name: "迷ったら 3 軒に絞る" }).click();
  await expect(page.locator("main")).toHaveAttribute("data-mode", "decide");
  // 画面の端（ノッチの下）に貼り付けない。.main と同じ余白（16px）を上に残して止まる。
  // 送るのは描き直しの後（次のフレーム）なので、止まるまで待って測る。
  await expect
    .poll(() =>
      page.locator("#app-head").evaluate((el) => Math.round(el.getBoundingClientRect().top)),
    )
    .toBe(16);
});

test("いま出ている地図で「地図で見る」を押しても、取り直さない", async ({ page }) => {
  await page.goto(WEB_URL);
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("data-mode", "map");
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/mcp") && request.method() === "POST")
      calls.push(request.postData() ?? "");
  });
  await page.getByRole("button", { name: "地図で見る" }).click();
  // 取り直すと、出ている地図が読み込み中に置き換わる。
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("data-pending-calls", "0");
  expect(calls.filter((body) => body.includes('"tools/call"'))).toEqual([]);
});
