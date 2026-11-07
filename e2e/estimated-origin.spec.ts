import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";

/*
 * 最初の 3 軒が接続元からの推定（「〇〇付近」）で出ていても、「近くで（現在地から）」と
 * 「現在地で出し直す」では端末の位置を使う（#364）。E2E のサーバーは接続元の位置を引かないので、
 * 最初の検索の要求にさいたま市の推定の位置（source: edge）を足して、本番の初めの状態を作る。
 * 端末の位置は横浜駅。公開 Nominatim には問い合わせない（座標をそのまま渡す）。
 */
const WEB = "http://localhost:3134";
const SAITAMA = { lat: 35.8617, lon: 139.6455, label: "さいたま市", source: "edge" };
const YOKOHAMA = { latitude: 35.4658, longitude: 139.6222 };

/** 位置の無い最初の検索だけ、推定の位置を足して送る。 */
async function startFromEdge(page: Page, tool: string) {
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    const args = body?.params?.arguments;
    if (body?.params?.name === tool && args && args.lat === undefined) {
      Object.assign(args, SAITAMA);
      return route.continue({ postData: JSON.stringify(body) });
    }
    return route.continue();
  });
}

async function allowYokohama(page: Page) {
  await page.context().grantPermissions(["geolocation"], { origin: WEB });
  await page.context().setGeolocation(YOKOHAMA);
}

const decideTitle = (page: Page) => page.locator("main h2[data-announce]").first();

async function openTop(page: Page) {
  await startFromEdge(page, "decide-iekei-ramen");
  await page.goto(WEB);
  await expect(page.locator("main")).toHaveAttribute("data-pending-calls", "0");
  await expect(decideTitle(page)).toContainText("さいたま市");
}

test("推定の位置で出ていても、券売機の「近くで」は端末の位置の 3 軒を出す（#364）", async ({
  page,
}) => {
  await allowYokohama(page);
  await openTop(page);
  await page.getByRole("button", { name: /^近くで/ }).click();
  await page.getByRole("button", { name: /^この条件で 3 軒を出す/ }).click();
  await expect(decideTitle(page)).toHaveText(/^迷ったらこの 3 軒（現在地）$/);
});

test("位置情報を拒否したときは、今までどおり推定の位置で出す（#364）", async ({ page }) => {
  await page.context().clearPermissions();
  await openTop(page);
  await page.getByRole("button", { name: /^近くで/ }).click();
  await page.getByRole("button", { name: /^この条件で 3 軒を出す/ }).click();
  await expect(page.locator("main")).toHaveAttribute("data-pending-calls", "0");
  await expect(decideTitle(page)).toContainText("さいたま市");
});

test("見出しの横の「現在地で出し直す」から、端末の位置の 3 軒に変わる（#364）", async ({
  page,
}) => {
  await allowYokohama(page);
  await openTop(page);
  const before = await page
    .locator("ul > li > button[data-shop-id]")
    .first()
    .getAttribute("data-shop-id");
  const again = page.getByRole("button", { name: "現在地で出し直す" });
  // キーボードで押す（焦点を戻すのはキーボードで押したときだけ。#156）。
  await again.focus();
  await page.keyboard.press("Enter");
  await expect(decideTitle(page)).toHaveText(/^迷ったらこの 3 軒（現在地）$/);
  await expect(page.locator("ul > li > button[data-shop-id]").first()).not.toHaveAttribute(
    "data-shop-id",
    before ?? "",
  );
  // 出し直した後も同じボタンが残り、焦点が戻る。
  await expect(again).toBeFocused();
});

test("家系マッチも、推定の場所から端末の位置で出し直せる（#364）", async ({ page }) => {
  await allowYokohama(page);
  await page.setViewportSize({ width: 375, height: 844 });
  await startFromEdge(page, "find-nearby-iekei-ramen");
  await page.goto(`${WEB}/match/`);
  const card = page.locator("article[data-shop-id]:not([aria-hidden])");
  await expect(card).toBeVisible();
  await expect(page.getByText(/さいたま市/).first()).toBeVisible();
  // 375px でも場所の名前を切らない（ボタンに押されて「さ…」になった）。
  const place = page.getByText(/さいたま市/).first();
  expect(await place.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  const before = await card.getAttribute("data-shop-id");
  // 押した後も行の高さを変えない（札がずれない）。
  const top = await card.boundingBox();
  await page.getByRole("button", { name: "現在地で出し直す" }).click();
  await expect(page.getByText("現在地", { exact: true })).toBeVisible();
  await expect(card).not.toHaveAttribute("data-shop-id", before ?? "");
  await expect(card).toHaveAttribute("aria-label", /^1枚目、/);
  expect((await card.boundingBox())?.y).toBeCloseTo(top?.y ?? 0, 0);
  // ボタンは出したまま（消すと行が詰まって札がずれる）。
  await expect(page.getByRole("button", { name: "現在地で出し直す" })).toBeVisible();
});

/** 端末の位置の検索（source: precise）の応答を、release() まで止めておく。 */
async function holdPreciseSearch(page: Page) {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.params?.arguments?.source === "precise") await gate;
    return route.fallback();
  });
  return () => release?.();
}

test("家系マッチで払っている途中に出し直しが届いても、前の山の札の決定を新しい山に持ち込まない（#364）", async ({
  page,
}) => {
  await allowYokohama(page);
  await startFromEdge(page, "find-nearby-iekei-ramen");
  const release = await holdPreciseSearch(page);
  await page.goto(`${WEB}/match/`);
  const card = page.locator("article[data-shop-id]:not([aria-hidden])");
  await expect(card).toHaveAttribute("aria-label", /^1枚目、/);
  await page.getByRole("button", { name: "現在地で出し直す" }).click();
  // 出し直しの応答を止めたまま「行きたい」で払い始め、札が飛んでいる間（約 220ms）に応答を返す。
  await page.getByRole("button", { name: /^行きたい →/ }).click();
  release();
  await expect(page.getByText("現在地", { exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(card).toHaveAttribute("aria-label", /^1枚目、/);
  await expect(page.getByRole("button", { name: /^行きたいリスト \d+$/ })).toHaveText(
    "行きたいリスト 0",
  );
});

test("家系マッチで前の場所の続きが遅れて届いても、新しい山に混ぜない（#364）", async ({ page }) => {
  await allowYokohama(page);
  // 後から登録した route が先に動く。推定の位置を足す方より後に登録して、先に止める。
  await startFromEdge(page, "find-nearby-iekei-ramen");
  let releaseNext: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => (releaseNext = resolve));
  let heldNext = false;
  await page.route("**/mcp", async (route) => {
    const args = route.request().postDataJSON()?.params?.arguments;
    // 推定の場所（さいたま市）の続き（offset 20）だけ止める。
    if (args?.source === "edge" && args.offset > 0) {
      heldNext = true;
      await gate;
    }
    return route.fallback();
  });
  await page.goto(`${WEB}/match/`);
  const card = page.locator("article[data-shop-id]:not([aria-hidden])");
  await expect(card).toHaveAttribute("aria-label", /^1枚目、/);
  // 残りが少なくなると続きを先に取る。15 枚払うと、さいたま市の続きが出て止まる。
  for (let i = 1; i <= 15; i++) {
    await page.keyboard.press("ArrowLeft");
    await expect(card).toHaveAttribute("aria-label", new RegExp(`^${i + 1}枚目、`));
  }
  await expect.poll(() => heldNext).toBe(true);
  await page.getByRole("button", { name: "現在地で出し直す" }).click();
  await expect(card).toHaveAttribute("aria-label", /^1枚目、/);
  releaseNext?.();
  await page.waitForTimeout(500);
  // 横浜駅の 20 軒を払い、範囲を広げた 21 枚目が、さいたま市の続きではない。
  for (let i = 1; i <= 20; i++) {
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(260);
  }
  await page.getByRole("button", { name: "範囲を広げる" }).click();
  await expect(card).toHaveAttribute("aria-label", /^21枚目、/);
  await expect(card).not.toContainText("埼玉県");
});
