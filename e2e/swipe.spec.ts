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
  await expect(page.locator('a[href*="threads.net"], a[href*="twitter.com"]')).toHaveText([
    "X でシェア",
    "Threads でシェア",
  ]);
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

test("パソコン幅は上のナビに 7 項目、スマホ幅は探し方の 4 項目と下のタブバー。どれも同じ高さ（#181・#194）", async ({
  page,
}) => {
  for (const [width, count] of [
    [390, 4],
    [1280, 7],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://localhost:3134/");
    const nav = page.getByRole("navigation", { name: "探し方" });
    await expect(nav.getByRole("button", { name: "地図で" })).toBeVisible();
    // 文字の上下の真ん中を測る（箱は同じ高さでも、<a> だけ文字が上に寄っていた）。
    const items = await nav.locator(":scope > *").evaluateAll((els) =>
      els
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const text = range.getBoundingClientRect();
          const box = el.getBoundingClientRect();
          return {
            row: Math.round(box.top),
            height: Math.round(box.height),
            middle: Math.round(text.top + text.height / 2),
          };
        }),
    );
    expect(items).toHaveLength(count);
    for (const item of items) expect(item.height).toBe(items[0].height);
    for (const item of items) {
      const sameRow = items.filter((other) => other.row === item.row);
      for (const other of sameRow)
        expect(Math.abs(other.middle - item.middle)).toBeLessThanOrEqual(1);
    }
    const tabbar = page.getByRole("navigation", { name: "機能" });
    if (width === 1280) {
      await expect(nav.getByRole("link", { name: "家系マッチ" })).toHaveAttribute(
        "href",
        "/match/",
      );
      await expect(nav.getByRole("link", { name: "家系カメラ" })).toHaveAttribute(
        "href",
        "/camera/",
      );
      await expect(nav.getByRole("link", { name: "診断" })).toHaveAttribute("href", "/shindan/");
      await expect(tabbar).toBeHidden();
    } else {
      await expect(tabbar).toBeVisible();
    }
  }
  const entry = page.getByRole("link", { name: "近くの家系とマッチング →" });
  await expect(entry).toHaveAttribute("href", "/match/");
  await entry.click();
  await expect(page).toHaveTitle("家系マッチ｜近くの家系と、マッチング");
  await expect(page.getByRole("heading", { level: 1, name: "家系マッチ" })).toBeVisible();
});

test("スマホ幅の最初の画面に食券 3 枚が入り、券売機はその下。いまの探し方は塗って示す（#204）", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:3134/");
  const tickets = page.locator("ul > li > button[data-shop-id]");
  await expect(tickets).toHaveCount(3);
  const tabTop = (await page.getByRole("navigation", { name: "機能" }).boundingBox())!.y;
  for (const box of await tickets.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().bottom),
  ))
    expect(box).toBeLessThanOrEqual(tabTop);
  // 読む順（焦点の順）も食券が先。見た目だけ入れ替えない。
  const order = await page.evaluate(() => {
    const ticket = document.querySelector("ul > li > button[data-shop-id]")!;
    const issue = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("発券する"),
    )!;
    return ticket.compareDocumentPosition(issue) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order).toBeTruthy();
  const current = page
    .getByRole("navigation", { name: "探し方" })
    .getByRole("button", { name: "迷ったら" });
  await expect(current).toHaveAttribute("aria-current", "page");
  const [fill, plain] = await page
    .getByRole("navigation", { name: "探し方" })
    .getByRole("button")
    .evaluateAll((els) => els.slice(0, 2).map((el) => getComputedStyle(el).backgroundColor));
  expect(fill).not.toBe(plain);
  // 家系マッチ・診断の入口は下のタブバーにあるので、一言の下には出さない。
  await expect(page.getByRole("link", { name: "近くの家系とマッチング →" })).toBeHidden();

  // 下の券売機で発券し直したら、出たばかりの 1 枚目へ焦点と画面を渡す（Tab で食券を飛ばさない）。
  const issue = page.getByRole("button", { name: /発券する/ });
  await issue.focus();
  await page.keyboard.press("Enter");
  await expect(tickets.first()).toBeFocused();
  await expect(tickets.first()).toBeInViewport();

  // パソコン幅は左に券売機・右に食券なので、読む順も券売機が先。幅を変えても選んだキーは残る。
  await page.getByRole("button", { name: /^直系・濃厚/ }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  // 幅の切り替えは matchMedia の通知のあとに描き直すので、そろうまで待つ。
  const machineFirst = () =>
    page.evaluate(() => {
      const ticket = document.querySelector("ul > li > button[data-shop-id]")!;
      const button = [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("発券する"),
      )!;
      return Boolean(button.compareDocumentPosition(ticket) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
  await expect.poll(machineFirst).toBe(true);
  await expect(page.getByRole("button", { name: /^直系・濃厚/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("スマホ幅でも、下の規約のリンクは 44px で押せ、見出しは文節の途中で割れない（#205）", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().grantPermissions(["geolocation"], { origin: "http://localhost:3134" });
  await page.context().setGeolocation(YOKOHAMA);
  for (const path of ["/", "/match/", "/shindan/", "/camera/", "/area/kanagawa/", "/connect"]) {
    await page.goto(`http://localhost:3134${path}`);
    const links = page.getByRole("navigation", { name: "規約" }).getByRole("link");
    await expect(links).toHaveCount(2);
    for (const box of await links.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().height),
    ))
      expect(box, path).toBeGreaterThanOrEqual(44);
  }
  // 見出しの各行が、文節の切れ目で始まる（「家系ラ / ーメン」と割らない）。
  const lines = async () =>
    page.locator("h1").evaluate((h) => {
      const range = document.createRange();
      const starts: string[] = [];
      let lineTop = -1;
      for (const node of [...h.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE))
        for (let i = 0; i < node.textContent!.length; i++) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const y = Math.round(range.getBoundingClientRect().top);
          if (y > lineTop + 4) starts.push(node.textContent!.slice(i, i + 2));
          lineTop = Math.max(lineTop, y);
        }
      return starts;
    });
  await page.goto("http://localhost:3134/area/kanagawa/");
  expect(await lines()).toEqual(["神奈", "家系"]);
  // 「の」以外の助詞（から・を）の後でも割れる。13 字の「都道府県から家系ラーメンの」は 1 行に入らない。
  await page.goto("http://localhost:3134/area/");
  expect((await lines()).every((s) => ["都道", "家系", "候補", "探す"].includes(s))).toBe(true);
  // 店名は固有名詞。ひらがなと漢字の境目（「しゃかりき|家」）でも切らない（区切りは呼ぶ側が渡す）。
  await page.goto("http://localhost:3134/shop/way-548841303/");
  expect(await page.locator("h1").innerHTML()).not.toContain("<wbr>");
  // 市区町村名も固有名詞。「さいたま|市」と切らない。
  await page.goto(`http://localhost:3134/area/saitama/${encodeURIComponent("さいたま市")}/`);
  expect(await page.locator("h1").innerHTML()).toContain("<wbr>さいたま市の<wbr>");
  await page.goto("http://localhost:3134/connect");
  expect((await lines()).every((s) => ["チャ", "家系", "探す"].includes(s))).toBe(true);
  // 家系マッチの見出しは 1 行。場所はその下の行で、音・行きたいは見出しの右のまま。
  await page.goto("http://localhost:3134/match/");
  await expect(page.locator("article[data-shop-id]").first()).toBeVisible();
  expect(await lines()).toHaveLength(1);
  const title = (await page.locator("h1").boundingBox())!;
  const wants = (await page.getByRole("button", { name: /^行きたい \d+$/ }).boundingBox())!;
  expect(wants.x).toBeGreaterThan(title.x + title.width);
});

test("レア札の印は、店名の途中で割れない（#209）", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().grantPermissions(["geolocation"], { origin: "http://localhost:3134" });
  // 酒田市上安町の町田商店。いちばん長い「〇〇で 1 軒だけの〇〇」の 1 つ（直す前は「町田 / 商店」）。
  await page.context().setGeolocation({ latitude: 38.92971, longitude: 139.859353 });
  await page.goto(URL);
  await expect(top(page)).toHaveAttribute("data-rare", "true");
  const brandLines = await top(page)
    .locator("[class*=rareTag]")
    .evaluate((tag) => {
      const text = [...tag.childNodes].find((n) => n.textContent === "町田商店")!;
      const range = document.createRange();
      range.selectNodeContents(text);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    });
  expect(brandLines).toBe(1);
});

test("スマホ幅の下のタブバーは、どの画面でもいまいる画面が分かり、キーボードで移れる（#194）", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [url, current] of [
    ["/", "探す"],
    ["/match/", "家系マッチ"],
    ["/camera/", "家系カメラ"],
    ["/shindan/", "診断"],
  ] as const) {
    await page.goto(`http://localhost:3134${url}`);
    const tabbar = page.getByRole("navigation", { name: "機能" });
    await expect(tabbar.getByRole("link")).toHaveText(["探す", "家系マッチ", "家系カメラ", "診断"]);
    await expect(tabbar.getByRole("link", { name: current })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(tabbar.locator('[aria-current="page"]')).toHaveCount(1);
  }
  // 都道府県・店のページ（静的な HTML）にも同じタブバー。アイコンは線の svg。
  for (const url of ["/area/kanagawa/", "/area/"]) {
    await page.goto(`http://localhost:3134${url}`);
    const tabbar = page.getByRole("navigation", { name: "機能" });
    await expect(tabbar).toBeVisible();
    await expect(tabbar.getByRole("link")).toHaveText(["探す", "家系マッチ", "家系カメラ", "診断"]);
    await expect(tabbar.locator("svg")).toHaveCount(4);
    await expect(tabbar.getByRole("link", { name: "探す" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  // チャットで使う方法（/connect、#196）にも同じタブバー。どのタブにも属さないので、選ばれたタブは無し。
  await page.goto("http://localhost:3134/connect");
  const connectBar = page.getByRole("navigation", { name: "機能" });
  await expect(connectBar.getByRole("link")).toHaveText([
    "探す",
    "家系マッチ",
    "家系カメラ",
    "診断",
  ]);
  await expect(connectBar.locator("svg")).toHaveCount(4);
  await expect(connectBar.locator('[aria-current="page"]')).toHaveCount(0);
  // パソコン幅の都道府県のページは、上のナビから開ける。
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("http://localhost:3134/area/kanagawa/");
  const links = page.getByRole("navigation", { name: "探し方" });
  for (const [name, href] of [
    ["家系マッチ", "/match/"],
    ["家系カメラ", "/camera/"],
    ["診断", "/shindan/"],
  ])
    await expect(links.getByRole("link", { name })).toHaveAttribute("href", href);
  await expect(page.getByRole("navigation", { name: "機能" })).toBeHidden();
  // /connect のパソコン幅の上のナビも、都道府県・店のページとそろえる。
  await page.goto("http://localhost:3134/connect");
  await expect(page.getByRole("navigation", { name: "探し方" }).getByRole("link")).toHaveText([
    "迷ったら",
    "都道府県から",
    "家系マッチ",
    "家系カメラ",
    "診断",
  ]);
  await page.goto("http://localhost:3134/area/kanagawa/");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(links.getByRole("link", { name: "家系マッチ" })).toBeHidden();
  await page.goto("http://localhost:3134/shindan/");
  // 診断の画面からキーボードで家系カメラへ。
  const camera = page
    .getByRole("navigation", { name: "機能" })
    .getByRole("link", { name: "家系カメラ" });
  await camera.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/camera\/$/);
});

test("スマホ幅でも、家系マッチの札と操作キーはタブバーより上に収まる（#182・#194）", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  // iPhone の画面下の余白はタブバーが受け持つので、ページの下の余白からは外す（二重に空けない）。
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--page-safe-bottom").trim(),
    ),
  ).toBe("0px");
  const tabTop = (await page.getByRole("navigation", { name: "機能" }).boundingBox())!.y;
  for (const name of [/^← パス/, /^戻す/, /^行きたい →/, /今日はここ/]) {
    const box = (await page.getByRole("button", { name }).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(tabTop);
  }
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

test("JavaScript を待たずに、上の行（ロゴと見出し）を先に出し、React の画面と同じ位置に置く（#203）", async ({
  browser,
}) => {
  const place = async (javaScriptEnabled: boolean) => {
    const context = await browser.newContext({
      javaScriptEnabled,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(URL);
    const heading = page.getByRole("heading", { level: 1, name: "家系マッチ" });
    await expect(heading).toBeVisible();
    await expect(page.getByRole("link", { name: "家系ラーメンを探す" }).first()).toBeVisible();
    const box = await heading.boundingBox();
    await context.close();
    return box;
  };
  // 骨組み（HTML だけ）と React の画面で、見出しの位置がずれない（入れ替わるときに跳ねない）。
  expect(await place(false)).toEqual(await place(true));
});
