import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";

/*
 * 家系マッチ（#166）。E2E のサーバーは接続元の位置を引かないので、ブラウザの位置（横浜駅）に頼る経路を通る。
 * 本番は接続元の推定（「〇〇市付近」）から始まり、位置の許可は求めない（tests/worker.test.ts で確かめている）。
 */
const URL = "http://localhost:3134/match/";
const YOKOHAMA = { latitude: 35.4658, longitude: 139.6222 };

async function open(page: Page) {
  await page.context().grantPermissions(["geolocation"], { origin: "http://localhost:3134" });
  await page.context().setGeolocation(YOKOHAMA);
  await page.goto(URL);
  await expect(top(page)).toBeVisible();
}
const top = (page: Page) => page.locator("article[data-shop-id]:not([aria-hidden])");
const wantsButton = (page: Page) => page.getByRole("button", { name: /^行きたい \d+$/ });
const ask = (page: Page) => page.locator("main p[aria-live]");
/** ボタンで 1 枚払い、次の札が出るまで待つ（札が飛んでいる間の押下は受けない作り）。 */
async function swipeBy(page: Page, name: RegExp) {
  const before = await top(page).getAttribute("aria-label");
  await page.getByRole("button", { name }).click();
  await expect(top(page).or(page.locator("section h2"))).not.toHaveAttribute(
    "aria-label",
    before ?? "",
  );
  await page.waitForTimeout(260);
}

test("近い順の食券が 1 枚ずつ出て、問いかけは持っている事実だけ（#166）", async ({ page }) => {
  await open(page);
  await expect(top(page)).toHaveAttribute("aria-label", /^1枚目、/);
  await expect(page.getByText("現在地", { exact: true })).toBeVisible();
  await expect(ask(page)).toContainText(/直線 \d+m。行ける距離？|ここ、知ってた？/);
  // 推定・参考値・直線距離・誤りの報告の案内を 1 回。
  await expect(page.getByText(/家系かどうかは推定、味の傾向は参考値/)).toHaveCount(1);
  const text = await page.locator("body").innerText();
  for (const word of ["人気", "おいしい", "営業中", "当たり"]) expect(text).not.toContain(word);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
});

test("キーボードだけで、行きたい・パス・戻す・今日はここ ができる", async ({ page }) => {
  await open(page);
  const first = await top(page).getAttribute("data-shop-id");
  await page.keyboard.press("ArrowRight");
  await expect(wantsButton(page)).toHaveText("行きたい 1");
  await expect(top(page)).toHaveAttribute("aria-label", /^2枚目、/);
  await page.keyboard.press("ArrowLeft");
  await expect(top(page)).toHaveAttribute("aria-label", /^3枚目、/);
  // 戻すで直前の 1 枚が帰ってくる。行きたいを戻すとリストからも消える。
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(top(page)).toHaveAttribute("data-shop-id", first!);
  await expect(wantsButton(page)).toHaveText("行きたい 0");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /^今日は「/ })).toBeFocused();
  await expect(page.getByRole("link", { name: "地図アプリで開く" })).toHaveAttribute(
    "href",
    /google\.com\/maps/,
  );
  await expect(ask(page)).toContainText("決まり。");
});

test("行きたいの数で出口が変わる: 1 → 地図 / 2〜3 → まわる店 / 4 以上 → 3 軒まで選ぶ", async ({
  page,
}) => {
  await open(page);
  const want = () => swipeBy(page, /^行きたい →/);
  await want();
  await wantsButton(page).click();
  await expect(page.getByRole("heading", { name: /^今日は「/ })).toBeVisible();
  await page.getByRole("button", { name: "続けて見る" }).click();
  await want();
  await wantsButton(page).click();
  await expect(page.getByRole("heading", { name: "まわる店（2 軒）" })).toBeVisible();
  await expect(page.getByRole("link", { name: "順路を地図アプリで開く" })).toHaveAttribute(
    "href",
    /google\.com\/maps\/dir/,
  );
  await page.getByRole("button", { name: "食券に戻る" }).click();
  await want();
  await want();
  await wantsButton(page).click();
  await expect(page.getByRole("heading", { name: "行きたい 4 軒" })).toBeVisible();
  const boxes = page.getByRole("checkbox");
  for (let i = 0; i < 3; i++) await boxes.nth(i).check();
  await expect(boxes.nth(3)).toBeDisabled();
  await page.getByRole("button", { name: "選んだ店で順路にする" }).click();
  await expect(page.getByRole("heading", { name: "まわる店（3 軒）" })).toBeVisible();
  // 決まった店は文字だけでシェアできる（画像つきは #46 と合流）。
  await expect(page.getByRole("link", { name: "X でシェア" })).toHaveAttribute(
    "href",
    /twitter\.com\/intent\/tweet/,
  );
});

test("指で払う: 足りなければ戻り、画面幅の 3 割を超えれば決まる", async ({ page }) => {
  await open(page);
  const box = (await top(page).boundingBox())!;
  const drag = async (dx: number) => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++)
      await page.mouse.move(box.x + box.width / 2 + (dx * i) / 12, box.y + box.height / 2);
    await page.mouse.up();
  };
  await drag(40);
  await expect(top(page)).toHaveAttribute("aria-label", /^1枚目、/);
  await drag(box.width * 0.5);
  await expect(top(page)).toHaveAttribute("aria-label", /^2枚目、/);
  await expect(wantsButton(page)).toHaveText("行きたい 1");
});

test("範囲を見終わったら区切り、範囲を広げると続きの 21 枚目から出る", async ({ page }) => {
  await open(page);
  for (let i = 0; i < 20; i++) await swipeBy(page, /^← パス/);
  await expect(
    page.getByRole("heading", { name: "この範囲の 20 軒は、全部見ました" }),
  ).toBeVisible();
  await expect(ask(page)).toContainText("この辺りの家系は全部見た。範囲を広げる？");
  await page.getByRole("button", { name: "範囲を広げる" }).click();
  await expect(top(page)).toHaveAttribute("aria-label", /^21枚目、/);
});

test("続きの取得に一度失敗しても「全部見た」にせず、取り直して 21 枚目へ進める", async ({
  page,
}) => {
  let failed = false;
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (!failed && body?.params?.arguments?.offset === 20) {
      failed = true;
      await route.abort();
    } else await route.continue();
  });
  await open(page);
  for (let i = 0; i < 20; i++) await swipeBy(page, /^← パス/);
  await expect(page.getByRole("heading", { name: "続きを読み込めませんでした" })).toBeVisible();
  // 上の問いかけも「全部見た」と言わない（下の紙と食い違わない）。
  await expect(ask(page)).toContainText("続きを読み込めませんでした。");
  await expect(ask(page)).not.toContainText("全部見た");
  await page.getByRole("button", { name: "もう一度読み込む" }).click();
  await page.getByRole("button", { name: "範囲を広げる" }).click();
  await expect(top(page)).toHaveAttribute("aria-label", /^21枚目、/);
});

test("前から行きたいに入っている店を払って戻しても、リストから消さない", async ({ page }) => {
  await open(page);
  await swipeBy(page, /^行きたい →/);
  await expect(wantsButton(page)).toHaveText("行きたい 1");
  // 開き直すと 1 枚目から。同じ店をもう一度右に払い、戻す。
  await page.reload();
  await expect(top(page)).toHaveAttribute("aria-label", /^1枚目、/);
  await swipeBy(page, /^行きたい →/);
  await page.getByRole("button", { name: /^戻す/ }).click();
  await expect(top(page)).toHaveAttribute("aria-label", /^1枚目、/);
  await expect(wantsButton(page)).toHaveText("行きたい 1");
});

test("札が飛んでいる間は、戻す・今日はここ を押せない（履歴を食い違わせない）", async ({
  page,
}) => {
  await open(page);
  await swipeBy(page, /^← パス/);
  const blocked = await page.evaluate(async () => {
    const buttons = [...document.querySelectorAll("button")];
    const want = buttons.find((b) => b.textContent?.startsWith("行きたい →"))!;
    const undo = buttons.find((b) => b.textContent?.startsWith("戻す"))!;
    const today = buttons.find((b) => b.textContent?.startsWith("今日はここ"))!;
    want.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { undo: undo.disabled, today: today.disabled };
  });
  expect(blocked).toEqual({ undo: true, today: true });
  await expect(top(page)).toHaveAttribute("aria-label", /^3枚目、/);
  await expect(page.getByRole("button", { name: /^戻す/ })).toBeEnabled();
});

test("札が飛んでいる間は、味の傾向も変えられない（山の位置を壊さない）", async ({ page }) => {
  await open(page);
  for (let i = 0; i < 3; i++) await swipeBy(page, /^← パス/);
  await expect(ask(page)).toContainText("3 連続パス。味の傾向を変えてみる？");
  const locked = await page.evaluate(async () => {
    const buttons = [...document.querySelectorAll("button")];
    const pass = buttons.find((b) => b.textContent?.startsWith("← パス"))!;
    const chip = buttons.find((b) => b.textContent === "クリーミー")!;
    pass.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return chip.disabled;
  });
  expect(locked).toBe(true);
  await expect(page.getByRole("button", { name: "クリーミー" })).toBeEnabled();
});

test("味で絞っても上の札が同じなら、指で払うと絞った山の 2 枚目へ進む", async ({ page }) => {
  await open(page);
  for (let i = 0; i < 3; i++) await swipeBy(page, /^← パス/);
  const before = await top(page).getAttribute("data-shop-id");
  await page.getByRole("button", { name: "直系・濃厚" }).click();
  await expect(top(page)).toHaveAttribute("aria-label", /^1枚目、/);
  // 横浜駅では、絞る前の 4 枚目がそのまま絞った山の 1 枚目になる（指の操作が付け直されない形）。
  expect(await top(page).getAttribute("data-shop-id")).toBe(before);
  const box = (await top(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++)
    await page.mouse.move(
      box.x + box.width / 2 + (box.width * 0.5 * i) / 12,
      box.y + box.height / 2,
    );
  await page.mouse.up();
  await expect(top(page)).toHaveAttribute("aria-label", /^2枚目、/);
  await page.waitForTimeout(260);
  await page.keyboard.press("Backspace");
  await expect(top(page)).toHaveAttribute("data-shop-id", before!);
});

test("位置が分からなくても、残してある「行きたい」は開ける", async ({ page }) => {
  await open(page);
  await swipeBy(page, /行きたい →/);
  await page.context().clearPermissions();
  await page.reload();
  await expect(page.getByRole("heading", { name: "現在地が分かりませんでした" })).toBeVisible();
  await wantsButton(page).click();
  await expect(page.getByRole("heading", { name: "現在地が分かりませんでした" })).toBeHidden();
});

test.describe("日本時間で", () => {
  test.use({ timezoneId: "Asia/Tokyo" });
  test("開いたまま 0 時を越えたら、今日出会った数を 0 に戻す", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install({ time: new Date("2026-10-10T14:59:30Z") }); // 23:59:30
    await open(page);
    await page.keyboard.press("ArrowRight");
    const counter = page.getByText("今日出会った知らない家系").locator("span").first();
    await expect(counter).toHaveText("1");
    await page.clock.runFor(60_000); // 0:00:30
    await expect(counter).toHaveText("0");
  });
});

test("札が無いとき（今日はここ の紙）でも、Backspace で戻せる", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ArrowRight");
  await expect(top(page)).toHaveAttribute("aria-label", /^2枚目、/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /^今日は「/ })).toBeVisible();
  await page.keyboard.press("Backspace");
  await expect(top(page)).toHaveAttribute("aria-label", /^1枚目、/);
  await expect(page).toHaveURL(URL);
});

test("動きを減らす設定では演出を出さず、操作はそのまま使える", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await expect(page.getByRole("progressbar", { name: "FEVER のゲージ" })).toBeHidden();
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
  await expect(top(page)).toHaveAttribute("aria-label", /^9枚目、/);
  expect(
    await page.evaluate(
      () => document.body.classList.length + document.querySelectorAll("[class*=feverOn]").length,
    ),
  ).toBe(0);
});

test("位置が分からなければ、その場で地名を入れて、その近くから始められる", async ({ page }) => {
  await page.context().clearPermissions();
  await page.goto(URL);
  await expect(page.getByRole("heading", { name: "現在地が分かりませんでした" })).toBeVisible();
  await page.getByLabel("地名・駅名").fill("横浜駅");
  await page.getByRole("button", { name: "この場所で探す" }).click();
  await expect(top(page)).toHaveAttribute("aria-label", /^1枚目、/);
  await expect(page.getByText("横浜駅", { exact: true })).toBeVisible();
});

test("文字は 14px より小さくしない（但し書きを含む）", async ({ page }) => {
  await open(page);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("main *")]
      .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()))
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 14)
      .map((el) => el.textContent!.trim().slice(0, 20)),
  );
  expect(small).toEqual([]);
});

test("トップの一言の下とナビから家系マッチへ行け、ナビの 5 項目は同じ高さ（#181）", async ({
  page,
}) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://localhost:3134/");
    const nav = page.getByRole("navigation", { name: "探し方" });
    await expect(nav.getByRole("link", { name: "家系マッチ" })).toHaveAttribute("href", "/match/");
    // 文字の上下の真ん中を測る（箱は同じ高さでも、<a> だけ文字が上に寄っていた）。
    const items = await nav.locator(":scope > *").evaluateAll((els) =>
      els.map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return { row: Math.round(box.top), middle: Math.round(text.top + text.height / 2) };
      }),
    );
    expect(items).toHaveLength(5);
    for (const item of items) {
      const sameRow = items.filter((other) => other.row === item.row);
      for (const other of sameRow)
        expect(Math.abs(other.middle - item.middle)).toBeLessThanOrEqual(1);
    }
  }
  const entry = page.getByRole("link", { name: "近くの家系とマッチング →" });
  await expect(entry).toHaveAttribute("href", "/match/");
  await entry.click();
  await expect(page).toHaveTitle("家系マッチ｜近くの家系と、マッチング");
  await expect(page.getByRole("heading", { level: 1, name: "家系マッチ" })).toBeVisible();
});

test("行きたいが 1 軒でも 2〜3 軒でも、読み直した後にリストを空にできる（#180）", async ({
  page,
}) => {
  await open(page);
  for (const count of [1, 2]) {
    for (let i = 0; i < count; i++) await swipeBy(page, /^行きたい →/);
    // 読み直すと戻す履歴は消える。リストは端末に残っている。
    await page.reload();
    await expect(top(page)).toBeVisible();
    await expect(wantsButton(page)).toHaveText(`行きたい ${count}`);
    await wantsButton(page).click();
    await expect(
      page.getByRole("heading", { name: count === 1 ? /^今日は「/ : "まわる店（2 軒）" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "リストを空にする" }).click();
    await expect(page.getByRole("heading", { name: "行きたいリストは空です" })).toBeVisible();
    await page.reload();
    await expect(wantsButton(page)).toHaveText("行きたい 0");
  }
  // 「今日はここ」で決めた紙には出さない（行きたいリストとは別の画面）。
  await expect(top(page)).toBeVisible();
  await page.getByRole("button", { name: /今日はここ/ }).click();
  await expect(page.getByRole("heading", { name: /^今日は「/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "リストを空にする" })).toHaveCount(0);
});

test("左上はほかのページと同じヘッダーでトップへ戻れ、390px で札と操作キーが 1 画面に入る（#182）", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.getByRole("heading", { level: 1, name: "家系マッチ" })).toBeVisible();
  for (const name of [/^← パス/, /^戻す/, /^行きたい →/, /今日はここ/]) {
    const box = (await page.getByRole("button", { name }).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(844);
  }
  const card = (await top(page).boundingBox())!;
  expect(card.height).toBeGreaterThanOrEqual(300);
  await page.getByRole("link", { name: "家系ラーメンを探す" }).click();
  await expect(page).toHaveURL("http://localhost:3134/");
});
