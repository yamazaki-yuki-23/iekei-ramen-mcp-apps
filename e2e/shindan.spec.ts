import { expect } from "@playwright/test";
import { test } from "./fixtures";

/* 家系タイプ診断（#167）。回答は送らず、画面の中だけで結果を出す。 */
const URL = "http://localhost:3134/shindan/";

test("6 問を 1 タップずつ答えると、結果のカードと注文の言葉が出て、家系マッチへ進める", async ({
  page,
}) => {
  const sent: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET") sent.push(req.url());
  });
  await page.goto(URL);
  const progress = page.getByRole("progressbar", { name: "進み具合" });
  for (const [i, label] of [
    "硬め",
    "濃いめ",
    "多め",
    "1 杯たのむ",
    "少し入れる",
    "飲み干す",
  ].entries()) {
    await expect(progress).toHaveAttribute("aria-valuenow", String(i));
    await expect(page.getByText(`${i + 1} / 6`)).toBeVisible();
    await page.getByRole("button", { name: label, exact: true }).click();
  }
  await expect(page.getByRole("heading", { level: 2, name: "カタコイオオメ三冠王" })).toBeFocused();
  await expect(page.getByText("カタメ・コイメ・オオメ", { exact: true })).toBeVisible();
  await expect(page.getByText("27 通りの注文のうち 1 通り")).toBeVisible();
  await expect(page.getByText("激レア", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "このタイプのあるある" })).toBeVisible();
  // 星は店の評価に読まれるので出さない。
  expect(await page.locator("body").innerText()).not.toMatch(/[★☆]/);
  await expect(page.getByText("ライス 1 杯派")).toBeVisible();
  await expect(page.getByText(/店の味とは結び付けていません/)).toBeVisible();
  const body = await page.locator("body").innerText();
  for (const word of ["合う店", "相性", "おすすめ", "人気"]) expect(body).not.toContain(word);
  // シェアは X が左、Threads が右の 2 つだけ。どちらもタイプごとの紙の URL を付ける。
  const share = page.locator('a[href*="threads.net"], a[href*="twitter.com"]');
  await expect(share).toHaveText(["X でシェア", "Threads でシェア"]);
  await expect(page.getByRole("button", { name: "画像でシェア" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "X でシェア" })).toHaveAttribute(
    "href",
    /url=https%3A%2F%2Fiekeiramen\.com%2Fshindan%2Fsankan%2F/,
  );
  expect(sent).toEqual([]);
  await page.getByRole("link", { name: "このタイプで近くの家系を探す" }).click();
  await expect(page).toHaveURL(/\/match\/$/);
});

test("ひとつ戻ると前の問いに戻り、もう一度診断すると 1 問目から", async ({ page }) => {
  await page.goto(URL);
  await page.getByRole("button", { name: "普通", exact: true }).click();
  await expect(page.getByRole("heading", { name: "味の濃さは？" })).toBeFocused();
  await page.getByRole("button", { name: "ひとつ戻る" }).click();
  await expect(page.getByRole("heading", { name: "麺の硬さは？" })).toBeFocused();
  for (let i = 0; i < 6; i++)
    await page.getByRole("button", { name: /^(普通|1 杯たのむ|少し入れる|半分くらい)$/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "ふつうを極めし者" })).toBeVisible();
  await page.getByRole("button", { name: "もう一度診断する" }).click();
  await expect(page.getByRole("heading", { name: "麺の硬さは？" })).toBeFocused();
});

test("シェアされたタイプの URL から診断すると、1 問目から始まり、最後に 2 人のカードが並ぶ", async ({
  page,
}) => {
  await page.goto(`${URL}futsuu/`);
  await expect(page.getByRole("heading", { name: "麺の硬さは？" })).toBeVisible();
  await expect(page.getByText(/友達は「ふつうを極めし者」でした/)).toBeVisible();
  for (const label of ["硬め", "濃いめ", "多め", "たのまない", "入れない", "麺だけ"])
    await page.getByRole("button", { name: label, exact: true }).click();
  const compare = page.getByRole("region", { name: "友達と比べる" });
  await expect(compare.getByRole("heading", { level: 3 })).toHaveText([
    "ふつうを極めし者",
    "カタコイオオメ三冠王",
  ]);
  await expect(compare.getByText(/相方どうし。/)).toBeVisible();
});

test("トップの一言の下から、家系タイプ診断へ行ける", async ({ page }) => {
  await page.goto("http://localhost:3134/");
  const entry = page.getByRole("link", { name: "家系タイプ診断（6 問）→" });
  await expect(entry).toHaveAttribute("href", "/shindan/");
  await entry.click();
  await expect(page.getByRole("heading", { name: "麺の硬さは？" })).toBeVisible();
});

test("焦点の輪は 2 色（黄の輪と縁）", async ({ page }) => {
  await page.goto(URL);
  // 丼のロゴ → 音を消す → 1 つ目の答え。
  for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
  const option = page.getByRole("button", { name: "硬め", exact: true });
  await expect(option).toBeFocused();
  expect(await option.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(/0px 0px 0px 5px/);
});

test("珍しさで演出が変わり、動きを減らす設定では止まる", async ({ page }) => {
  const answer = async (labels: string[]) => {
    await page.goto(URL);
    for (const label of labels)
      await page.getByRole("button", { name: label, exact: true }).click();
  };
  const card = page.locator("article[data-rarity]").first();
  await answer(["硬め", "濃いめ", "多め", "1 杯たのむ", "少し入れる", "飲み干す"]);
  await expect(card).toHaveAttribute("data-rarity", "激レア");
  await expect(page.getByText("激レア！")).toBeVisible();
  await answer(["硬め", "普通", "普通", "1 杯たのむ", "少し入れる", "飲み干す"]);
  await expect(card).toHaveAttribute("data-rarity", "レア");
  await expect(page.getByText("激レア！")).toHaveCount(0);
  await answer(["硬め", "薄め", "普通", "1 杯たのむ", "少し入れる", "飲み干す"]);
  await expect(card).toHaveAttribute("data-rarity", "定番");
  await expect(page.getByText("いちばん多くの組み合わせが行き着く注文")).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await answer(["硬め", "濃いめ", "多め", "1 杯たのむ", "少し入れる", "飲み干す"]);
  const moving = await card.evaluate(
    (el) =>
      [el, ...el.querySelectorAll("*")].filter((n) => {
        const s = getComputedStyle(n);
        return s.display !== "none" && s.animationName !== "none";
      }).length,
  );
  expect(moving).toBe(0);
});

test("答え・発券・レア・激レアで音が鳴り、高い音は出さない。消音すると鳴らない", async ({
  page,
}) => {
  // 鳴らした音を数える（録音の払う音・発券の音・合成の音）。
  await page.addInitScript(() => {
    const log: { kind: string; freq?: number }[] = [];
    Object.assign(window, { soundLog: log });
    // 周波数は setValueAtTime で決めるので、決めた値を覚えておく。
    const set = AudioParam.prototype.setValueAtTime;
    AudioParam.prototype.setValueAtTime = function (value, time) {
      if (!("first" in this)) Object.assign(this, { first: value });
      return set.call(this, value, time);
    };
    const tone = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (when) {
      log.push({ kind: "tone", freq: (this.frequency as AudioParam & { first: number }).first });
      return tone.call(this, when);
    };
    // 録音の払う音は 0.25 秒、発券のノイズは 0.14 秒。
    const buffer = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      log.push({ kind: this.buffer!.duration > 0.2 ? "buffer" : "noise" });
      return buffer.apply(this, args);
    };
  });

  const sounds = () =>
    page.evaluate(
      () => (window as unknown as { soundLog: { kind: string; freq?: number }[] }).soundLog,
    );
  const answer = async (labels: string[]) => {
    await page.goto(URL);
    for (const label of labels)
      await page.getByRole("button", { name: label, exact: true }).click();
    await page.waitForTimeout(1600);
  };
  // 定番: 答えの音 6 回（録音）と発券の「ゴトッ」（低い合成音とノイズ）だけ。
  await answer(["硬め", "薄め", "普通", "1 杯たのむ", "少し入れる", "飲み干す"]);
  let log = await sounds();
  expect(log.filter((s) => s.kind === "buffer")).toHaveLength(6);
  expect(log.filter((s) => s.kind === "tone").map((s) => s.freq)).toEqual([120]);
  // レア: 発券に加えて、銀の光の短い音（3 音）。
  await answer(["硬め", "普通", "普通", "1 杯たのむ", "少し入れる", "飲み干す"]);
  log = await sounds();
  expect(log.filter((s) => s.kind === "tone").map((s) => s.freq)).toEqual([120, 523, 659, 784]);
  // 激レア: 低い和音と発券。
  await answer(["硬め", "濃いめ", "多め", "1 杯たのむ", "少し入れる", "飲み干す"]);
  log = await sounds();
  const tones = log.filter((s) => s.kind === "tone").map((s) => s.freq!);
  expect(tones).toContain(98);
  expect(tones).toContain(120);
  expect(Math.max(...tones)).toBeLessThanOrEqual(1500);
  // 消音すると、家系マッチと同じ設定で鳴らない。
  await page.goto(URL);
  await page.getByRole("button", { name: "音を消す" }).click();
  await page.reload();
  for (const label of ["硬め", "濃いめ", "多め", "1 杯たのむ", "少し入れる", "飲み干す"])
    await page.getByRole("button", { name: label, exact: true }).click();
  await page.waitForTimeout(1600);
  expect(await sounds()).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("iekei-swipe-muted"))).toBe("1");
});
