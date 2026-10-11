import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";

/*
 * 家系カメラ（仮、#190）。写真は端末の中で仕上げ、サーバーに送らない。書き出した写真に位置情報が残らない。
 * E2E のサーバーは接続元の位置を引かないので、ブラウザの位置（横浜駅）から近い順の店が出る。
 */
const URL = "http://localhost:3134/camera/";
const GPS = "GPS 35.4658N 139.6222E";

/** 位置情報入りの写真（JPEG の先頭に EXIF の APP1 を差し込む）を、ブラウザの canvas で作る。 */
async function photoWithGps(page: Page, width = 640, height = 480): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ([w, h]) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#c8742c");
      g.addColorStop(1, "#3a2414");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.9));
      return [...new Uint8Array(await blob.arrayBuffer())];
    },
    [width, height],
  );
  const jpeg = Buffer.from(bytes);
  // TIFF（ビッグエンディアン、項目 0 の IFD）＋目印の文字列。
  const payload = Buffer.concat([
    Buffer.from("Exif\0\0MM\0*\0\0\0\x08\0\0\0\0\0\0", "binary"),
    Buffer.from(GPS),
  ]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.alloc(2), payload]);
  app1.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

async function open(page: Page) {
  await page.context().grantPermissions(["geolocation"], { origin: "http://localhost:3134" });
  await page.context().setGeolocation({ latitude: 35.4658, longitude: 139.6222 });
  // スマホの共有の画面の代わりに、渡されたものを覚えておく。
  await page.addInitScript(() => {
    const shared: { text?: string; files: number[][] }[] = [];
    Object.assign(window, { shared });
    Object.assign(navigator, {
      canShare: (data: ShareData) => Boolean(data.files?.length),
      share: async (data: ShareData) => {
        const files = await Promise.all(
          (data.files ?? []).map(async (f) => [...new Uint8Array(await f.arrayBuffer())]),
        );
        shared.push({ text: data.text, files });
      },
    });
  });
  await page.goto(URL);
}

test("撮って店を選ぶと、X 用と Threads 用の文ができ、写真と文を共有の画面に渡せる（位置情報は消える）", async ({
  page,
}) => {
  const posted: number[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET") posted.push(req.postDataBuffer()?.length ?? 0);
  });
  await open(page);
  const photo = await photoWithGps(page);
  expect(photo.includes(Buffer.from(GPS))).toBe(true);
  await page
    .getByLabel("撮る", { exact: true })
    .setInputFiles({ name: "ramen.jpg", mimeType: "image/jpeg", buffer: photo });

  await expect(page.getByRole("heading", { name: "どの店の一杯？" })).toBeVisible();
  const first = page.locator("ul li button").first();
  const name = (await first.locator("strong").innerText()).trim();
  await first.click();
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();

  const xText = page.getByRole("figure", { name: "X の文" });
  await expect(xText).toContainText("#家系ラーメン");
  await expect(xText).toContainText("#横浜市");
  await expect(page.getByRole("figure", { name: "Threads の文" })).toContainText("#家系ラーメン");
  expect(
    (await page.getByRole("figure", { name: "Threads の文" }).innerText()).match(/#\S+/g),
  ).toEqual(["#家系ラーメン"]);

  // 仕上げ・ひとことが反映される。本文に URL は入れない。
  const pixels = () => page.locator("canvas").evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const plain = await pixels();
  await page.getByRole("button", { name: "夜の一杯" }).click();
  await expect.poll(pixels).not.toBe(plain);
  await page.getByRole("button", { name: "沁みた" }).click();
  await expect(page.getByRole("button", { name: "沁みた" })).toBeFocused();
  await expect(xText).toContainText("で一杯。沁みた。");
  expect(await xText.innerText()).not.toContain("https://");
  await expect(page.getByText("注文を入れる")).toHaveCount(0);

  // X が左、Threads が右。押すと、写真と X 用の文を共有の画面に渡す。
  await expect(page.getByRole("button", { name: /に投稿$/ })).toHaveText([
    "X に投稿",
    "Threads に投稿",
  ]);
  await page.getByRole("button", { name: "X に投稿" }).click();
  const shared = await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { shared: { text: string; files: number[][] }[] }).shared,
      ),
    )
    .toHaveLength(1)
    .then(() =>
      page.evaluate(
        () => (window as unknown as { shared: { text: string; files: number[][] }[] }).shared[0],
      ),
    );
  expect(shared.text).toBe(await xText.locator("p").innerText());
  const out = Buffer.from(shared.files[0]);
  expect(out.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  expect(out.includes(Buffer.from("Exif"))).toBe(false);
  expect(out.includes(Buffer.from(GPS))).toBe(false);

  // 片方に投稿しても画面と写真は残り、続けてもう片方にも投稿できる。
  await expect(page.getByRole("status")).toHaveText(
    /X に渡しました。続けて Threads にも投稿できます。/,
  );
  await page.getByRole("button", { name: "Threads に投稿" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { shared: unknown[] }).shared.length))
    .toBe(2);
  await expect(page.getByRole("status")).toHaveText("X・Threads に渡しました。");

  // 写真はサーバーに送らない（送ったのは店を探す小さな問い合わせだけ）。
  expect(Math.max(0, ...posted)).toBeLessThan(2000);
});

test("写真付きで渡せない端末（PC）では、保存・コピー・投稿画面を開く手順を出す", async ({
  page,
}) => {
  await page.context().grantPermissions(["geolocation", "clipboard-read", "clipboard-write"], {
    origin: "http://localhost:3134",
  });
  await page.context().setGeolocation({ latitude: 35.4658, longitude: 139.6222 });
  await page.goto(URL);
  await page.getByLabel("撮った写真から選ぶ").setInputFiles({
    name: "ramen.jpg",
    mimeType: "image/jpeg",
    buffer: await photoWithGps(page),
  });
  await page.locator("ul li button").first().click();
  await page.getByRole("button", { name: "Threads に投稿" }).click();
  const steps = page.getByRole("region", { name: "写真を添えて Threads に投稿する" });
  await expect(steps.getByRole("heading")).toBeFocused();
  const download = page.waitForEvent("download");
  await steps.getByRole("button", { name: "写真を保存" }).click();
  expect((await download).suggestedFilename()).toBe("iekei-ramen.jpg");
  await steps.getByRole("button", { name: "文をコピー" }).click();
  await expect(steps.getByRole("status")).toHaveText("文をコピーしました。");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("#家系ラーメン");
  await expect(steps.getByRole("link", { name: "Threads の投稿画面を開く" })).toHaveAttribute(
    "href",
    /threads\.net\/intent\/post/,
  ); // 仕上げや文を変えたら、古い写真と文の手順は隠す。
  await page.getByRole("button", { name: "フィルム" }).click();
  await expect(steps).toHaveCount(0);
  await page.getByRole("button", { name: "Threads に投稿" }).click();
  await expect(steps).toBeVisible();
  await page.getByRole("button", { name: "また来たい" }).click();
  await expect(steps).toHaveCount(0);
});

test("共有の画面を開けなかった・閉じたときも手順を出し、コピーできなければそう言う", async ({
  page,
}) => {
  await page.context().grantPermissions(["geolocation"], { origin: "http://localhost:3134" });
  await page.context().setGeolocation({ latitude: 35.4658, longitude: 139.6222 });
  await page.addInitScript(() => {
    Object.assign(navigator, {
      canShare: () => true,
      share: async () => {
        throw new DOMException("共有先がありません", "AbortError");
      },
      clipboard: {
        writeText: async () => {
          throw new DOMException("拒否", "NotAllowedError");
        },
      },
    });
  });
  await page.goto(URL);
  await page.getByLabel("撮る", { exact: true }).setInputFiles({
    name: "ramen.jpg",
    mimeType: "image/jpeg",
    buffer: await photoWithGps(page),
  });
  await page.locator("ul li button").first().click();
  await page.getByRole("button", { name: "X に投稿" }).click();
  const steps = page.getByRole("region", { name: "写真を添えて X に投稿する" });
  await expect(steps.getByRole("link", { name: "X の投稿画面を開く" })).toHaveAttribute(
    "href",
    /twitter\.com\/intent\/tweet/,
  );
  await steps.getByRole("button", { name: "文をコピー" }).click();
  await expect(steps.getByRole("status")).toHaveText(/コピーできませんでした/);
});

test("店の候補に推定の但し書き・報告の案内・出典が出て、地名を打っている間は焦点が動かない", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("撮る", { exact: true }).setInputFiles({
    name: "ramen.jpg",
    mimeType: "image/jpeg",
    buffer: await photoWithGps(page),
  });
  await expect(page.getByRole("heading", { name: "どの店の一杯？" })).toBeFocused();
  await expect(page.getByText(/家系かどうかは推定で/)).toBeVisible();
  await expect(page.getByRole("link", { name: "トップ" })).toHaveAttribute("href", "/");
  await expect(page.getByText("店舗データ: © OpenStreetMap contributors（ODbL）")).toBeVisible();
  const place = page.getByLabel("地名・駅名で探す");
  await place.click();
  await page.keyboard.type("横浜駅");
  await expect(place).toHaveValue("横浜駅");
  await expect(place).toBeFocused();
});

test("地名の検索が遅れて返っても、あとで頼んだ「いまいる場所」の結果を上書きしない", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("撮る", { exact: true }).setInputFiles({
    name: "ramen.jpg",
    mimeType: "image/jpeg",
    buffer: await photoWithGps(page),
  });
  await expect(page.locator("ul li button").first()).toBeVisible();
  const label = page.getByText(/から近い順（直線距離）/);
  // 地名の検索の返事だけを遅らせる。
  await page.route("**/mcp", async (route) => {
    if (route.request().postData()?.includes("geocode-place"))
      await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  // 遅らせた地名の検索のあとに来る、その地名での店の問い合わせの返事を待つ。
  const stale = page.waitForResponse(
    (res) =>
      res.url().endsWith("/mcp") && Boolean(res.request().postData()?.includes('"source":"place"')),
  );
  await page.getByLabel("地名・駅名で探す").fill("横浜駅");
  await page.getByRole("button", { name: "探す", exact: true }).click();
  await page.getByRole("button", { name: "いまいる場所で探し直す" }).click();
  await expect(label).toHaveText("現在地から近い順（直線距離）");
  await stale;
  // 返事を画面に出し終えるまで 2 フレーム待つ。
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await expect(label).toHaveText("現在地から近い順（直線距離）");
});

test("写真を選び直したら、遅れて読み終えた前の写真で上書きしない", async ({ page }) => {
  await open(page);
  // 1 枚目の読み込みだけを遅らせ、読み終えたことを知らせる。
  await page.evaluate(() => {
    const load = window.createImageBitmap.bind(window);
    let first = true;
    let done: (() => void) | undefined;
    Object.assign(window, {
      slowDone: new Promise<void>((r) => (done = r)),
      createImageBitmap: async (...args: Parameters<typeof createImageBitmap>) => {
        const slow = first;
        first = false;
        const bitmap = await load(...args);
        if (slow) {
          await new Promise((r) => setTimeout(r, 500));
          queueMicrotask(() => done?.());
        }
        return bitmap;
      },
    });
  });
  // 1 枚目は横長、2 枚目は縦長。
  const wide = await photoWithGps(page, 640, 480);
  const tall = await photoWithGps(page, 480, 640);
  await page
    .getByLabel("撮る", { exact: true })
    .setInputFiles({ name: "a.jpg", mimeType: "image/jpeg", buffer: wide });
  await page
    .getByLabel("撮った写真から選ぶ")
    .setInputFiles({ name: "b.jpg", mimeType: "image/jpeg", buffer: tall });
  await page.evaluate(() => (window as unknown as { slowDone: Promise<void> }).slowDone);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.locator("ul li button").first().click();
  const size = await page.locator("canvas").evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
  expect(size[1]).toBeGreaterThan(size[0]);
});

test("撮り直すと、前の写真の画素を手放す", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const load = window.createImageBitmap.bind(window);
    const made: ImageBitmap[] = [];
    Object.assign(window, {
      made,
      createImageBitmap: async (...args: Parameters<typeof createImageBitmap>) => {
        const bitmap = await load(...args);
        made.push(bitmap);
        return bitmap;
      },
    });
  });
  const photo = await photoWithGps(page);
  const closed = () =>
    page.evaluate(() =>
      (window as unknown as { made: ImageBitmap[] }).made.map((b) => b.width === 0),
    );
  await page
    .getByLabel("撮る", { exact: true })
    .setInputFiles({ name: "a.jpg", mimeType: "image/jpeg", buffer: photo });
  await page.locator("ul li button").first().click();
  await page.getByRole("button", { name: "撮り直す" }).click();
  // close した ImageBitmap は幅が 0 になる。
  expect(await closed()).toEqual([true]);
  // 店を選ぶ段からの撮り直しでも手放す。
  await page
    .getByLabel("撮る", { exact: true })
    .setInputFiles({ name: "b.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByRole("heading", { name: "どの店の一杯？" })).toBeVisible();
  await page.getByRole("button", { name: "撮り直す" }).click();
  expect(await closed()).toEqual([true, true]);
});

test("店を選び直しても、店を探す接続を作り足さない", async ({ page }) => {
  const connects: string[] = [];
  page.on("request", (req) => {
    if (req.postData()?.includes('"method":"initialize"')) connects.push(req.url());
  });
  await open(page);
  await page.getByLabel("撮る", { exact: true }).setInputFiles({
    name: "ramen.jpg",
    mimeType: "image/jpeg",
    buffer: await photoWithGps(page),
  });
  for (let i = 0; i < 3; i++) {
    await page.locator("ul li button").first().click();
    await page.getByRole("button", { name: "店を選び直す" }).click();
    await expect(page.getByRole("heading", { name: "どの店の一杯？" })).toBeVisible();
  }
  await expect(page.locator("ul li button").first()).toBeVisible();
  expect(connects).toHaveLength(1);
});

test("加工・フレーム・判子を組み合わせられ、判子は指と矢印キーで動き、書き出しても位置情報は残らない", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("撮る", { exact: true }).setInputFiles({
    name: "ramen.jpg",
    mimeType: "image/jpeg",
    buffer: await photoWithGps(page),
  });
  await page.locator("ul li button").first().click();
  const canvas = page.locator("canvas");
  const pixels = () => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const size = () => canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height]);

  // 加工はどれも絵を変える。
  const seen = new Set([await pixels()]);
  for (const name of ["漫画", "集中線", "ドット絵"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect.poll(async () => seen.has(await pixels())).toBe(false);
    seen.add(await pixels());
  }
  // フレームは写真の周りに紙を足す（大きさが変わる）。
  const [w, h] = await size();
  await page.getByRole("button", { name: "食券", exact: true }).click();
  await expect.poll(async () => (await size())[1]).toBeGreaterThan(h);
  expect((await size())[0]).toBeGreaterThan(w);

  // ひとことを選ぶと判子になる。なぞると動き、矢印キーでも動く。
  await expect(page.getByLabel("判子の大きさ")).toHaveCount(0);
  await page.getByRole("button", { name: "沁みた" }).click();
  await expect(page.getByLabel("判子の大きさ")).toBeVisible();
  const before = await pixels();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.65);
  await page.mouse.up();
  await expect.poll(pixels).not.toBe(before);
  const dragged = await pixels();
  await canvas.focus();
  await page.keyboard.press("ArrowUp");
  await expect.poll(pixels).not.toBe(dragged);
  const moved = await pixels();
  await page.getByLabel("判子の大きさ").fill("0.3");
  await expect.poll(pixels).not.toBe(moved);

  // 組み合わせて書き出しても、位置情報は残らない。
  await page.getByRole("button", { name: "X に投稿" }).click();
  const file = await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { shared: { files: number[][] }[] }).shared.length),
    )
    .toBe(1)
    .then(() =>
      page.evaluate(
        () => (window as unknown as { shared: { files: number[][] }[] }).shared[0].files[0],
      ),
    );
  const out = Buffer.from(file);
  expect(out.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  expect(out.includes(Buffer.from("Exif"))).toBe(false);
  expect(out.includes(Buffer.from(GPS))).toBe(false);
});

test("地名で探して店を選び、選び直しても、さっき探した場所のまま出す", async ({ page }) => {
  await open(page);
  await page.getByLabel("撮る", { exact: true }).setInputFiles({
    name: "ramen.jpg",
    mimeType: "image/jpeg",
    buffer: await photoWithGps(page),
  });
  const label = page.getByText(/から近い順（直線距離）/);
  await expect(label).toHaveText("現在地から近い順（直線距離）");
  await page.getByLabel("地名・駅名で探す").fill("横浜駅");
  await page.getByRole("button", { name: "探す", exact: true }).click();
  await expect(label).not.toHaveText("現在地から近い順（直線距離）");
  const searched = await label.innerText();
  await page.locator("ul li button").first().click();
  await page.getByRole("button", { name: "店を選び直す" }).click();
  await expect(page.locator("ul li button").first()).toBeVisible();
  await expect(label).toHaveText(searched);
});

test("投稿の段にも推定の但し書きと報告の案内があり、入力にも焦点の輪が出る", async ({ page }) => {
  await open(page);
  await page.getByLabel("撮る", { exact: true }).setInputFiles({
    name: "ramen.jpg",
    mimeType: "image/jpeg",
    buffer: await photoWithGps(page),
  });
  await page.locator("ul li button").first().click();
  await expect(page.getByText(/家系かどうかは推定で/)).toBeVisible();
  await expect(page.getByRole("link", { name: "トップ" })).toHaveAttribute("href", "/");
  const check = page.getByLabel("右下に「iekeiramen.com」を入れる");
  await check.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(check).toBeFocused();
  expect(await check.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(/0px 0px 0px 5px/);
});

test("遅れて返った地名の検索は、選び直しのときの場所も上書きしない", async ({ page }) => {
  await open(page);
  await page.getByLabel("撮る", { exact: true }).setInputFiles({
    name: "ramen.jpg",
    mimeType: "image/jpeg",
    buffer: await photoWithGps(page),
  });
  await expect(page.locator("ul li button").first()).toBeVisible();
  const label = page.getByText(/から近い順（直線距離）/);
  await page.route("**/mcp", async (route) => {
    if (route.request().postData()?.includes("geocode-place"))
      await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  const stale = page.waitForResponse(
    (res) =>
      res.url().endsWith("/mcp") && Boolean(res.request().postData()?.includes('"source":"place"')),
  );
  await page.getByLabel("地名・駅名で探す").fill("横浜駅");
  await page.getByRole("button", { name: "探す", exact: true }).click();
  await page.getByRole("button", { name: "いまいる場所で探し直す" }).click();
  await expect(label).toHaveText("現在地から近い順（直線距離）");
  await stale;
  await page.locator("ul li button").first().click();
  await page.getByRole("button", { name: "店を選び直す" }).click();
  await expect(page.locator("ul li button").first()).toBeVisible();
  await expect(label).toHaveText("現在地から近い順（直線距離）");
});

test("地名の検索が返る前に店を選んで選び直しても、あとから返った地名で場所を書き換えない", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("撮る", { exact: true }).setInputFiles({
    name: "ramen.jpg",
    mimeType: "image/jpeg",
    buffer: await photoWithGps(page),
  });
  await expect(page.locator("ul li button").first()).toBeVisible();
  const label = page.getByText(/から近い順（直線距離）/);
  await page.route("**/mcp", async (route) => {
    if (route.request().postData()?.includes("geocode-place"))
      await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  const stale = page.waitForResponse(
    (res) =>
      res.url().endsWith("/mcp") && Boolean(res.request().postData()?.includes('"source":"place"')),
  );
  await page.getByLabel("地名・駅名で探す").fill("横浜駅");
  await page.getByRole("button", { name: "探す", exact: true }).click();
  // 地名の検索が返る前に、いま見えている店を選んで、すぐ選び直す。
  await page.locator("ul li button").first().click();
  await page.getByRole("button", { name: "店を選び直す" }).click();
  await expect(label).toHaveText("現在地から近い順（直線距離）");
  await stale;
  await page.locator("ul li button").first().click();
  await page.getByRole("button", { name: "店を選び直す" }).click();
  await expect(page.locator("ul li button").first()).toBeVisible();
  await expect(label).toHaveText("現在地から近い順（直線距離）");
});

test("地名の検索が返る前に店を選んで、仕上げの段にいる間に返っても、選び直しの場所を書き換えない", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("撮る", { exact: true }).setInputFiles({
    name: "ramen.jpg",
    mimeType: "image/jpeg",
    buffer: await photoWithGps(page),
  });
  await expect(page.locator("ul li button").first()).toBeVisible();
  const label = page.getByText(/から近い順（直線距離）/);
  await page.route("**/mcp", async (route) => {
    if (route.request().postData()?.includes("geocode-place"))
      await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  const stale = page.waitForResponse(
    (res) =>
      res.url().endsWith("/mcp") && Boolean(res.request().postData()?.includes('"source":"place"')),
  );
  await page.getByLabel("地名・駅名で探す").fill("横浜駅");
  await page.getByRole("button", { name: "探す", exact: true }).click();
  // 地名の検索が返る前に店を選び、仕上げの段にいる間に返事が届く。
  await page.locator("ul li button").first().click();
  await expect(page.getByRole("button", { name: "店を選び直す" })).toBeVisible();
  await stale;
  await page.getByRole("button", { name: "店を選び直す" }).click();
  await expect(page.locator("ul li button").first()).toBeVisible();
  await expect(label).toHaveText("現在地から近い順（直線距離）");
});

test("前に撮った写真を選ぶと、フレームにはその写真の日付が入る", async ({ page }) => {
  await open(page);
  const photo = await photoWithGps(page);
  // ファイルの日付が 2026 年 1 月 2 日の写真を選ぶ。
  await page.getByLabel("撮った写真から選ぶ").evaluate(
    (input: HTMLInputElement, bytes: number[]) => {
      const file = new File([new Uint8Array(bytes)], "old.jpg", {
        type: "image/jpeg",
        lastModified: new Date(2026, 0, 2, 12, 0).getTime(),
      });
      const list = new DataTransfer();
      list.items.add(file);
      input.files = list.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [...photo],
  );
  await page.locator("ul li button").first().click();
  await page.getByRole("button", { name: "ポラロイド", exact: true }).click();
  await expect(page.getByText(/フレームの日付: 2026\.01\.02/)).toBeVisible();
});

test("撮り直すと撮る段の見出しへ焦点が移り、但し書きのリンクにも焦点の輪が出る", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("撮る", { exact: true }).setInputFiles({
    name: "ramen.jpg",
    mimeType: "image/jpeg",
    buffer: await photoWithGps(page),
  });
  const top = page.getByRole("link", { name: "トップ" });
  await top.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(top).toBeFocused();
  expect(await top.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(/0px 0px 0px 5px/);
  await page.getByRole("button", { name: "撮り直す" }).click();
  await expect(page.getByRole("heading", { name: "撮った一杯から、投稿の文を作る" })).toBeFocused();
});

test("投稿の準備が重なったら、最後に押した方の手順を出す", async ({ page }) => {
  await page.context().grantPermissions(["geolocation"], { origin: "http://localhost:3134" });
  await page.context().setGeolocation({ latitude: 35.4658, longitude: 139.6222 });
  await page.goto(URL);
  await page.getByLabel("撮る", { exact: true }).setInputFiles({
    name: "ramen.jpg",
    mimeType: "image/jpeg",
    buffer: await photoWithGps(page),
  });
  await page.locator("ul li button").first().click();
  // 1 回目の書き出しだけを遅らせる。
  await page.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    let first = true;
    let done: (() => void) | undefined;
    Object.assign(window, { slowDone: new Promise<void>((r) => (done = r)) });
    HTMLCanvasElement.prototype.toBlob = function (callback, ...rest) {
      const slow = first;
      first = false;
      return toBlob.call(
        this,
        (b) =>
          setTimeout(
            () => {
              callback(b);
              if (slow) queueMicrotask(() => done?.());
            },
            slow ? 600 : 0,
          ),
        ...rest,
      );
    };
  });
  await page.getByRole("button", { name: "X に投稿" }).click();
  await page.getByRole("button", { name: "Threads に投稿" }).click();
  await expect(page.getByRole("region", { name: "写真を添えて Threads に投稿する" })).toBeVisible();
  // 遅れた 1 回目が返っても、Threads の手順のまま。
  await page.evaluate(() => (window as unknown as { slowDone: Promise<void> }).slowDone);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await expect(page.getByRole("region", { name: /^写真を添えて/ })).toHaveAccessibleName(
    "写真を添えて Threads に投稿する",
  );
});

test("書き出しの途中で仕上げを変えたら、古い写真と文では共有の画面を開かない", async ({ page }) => {
  await open(page);
  await page.getByLabel("撮る", { exact: true }).setInputFiles({
    name: "ramen.jpg",
    mimeType: "image/jpeg",
    buffer: await photoWithGps(page),
  });
  await page.locator("ul li button").first().click();
  await page.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    let first = true;
    let done: (() => void) | undefined;
    Object.assign(window, { slowDone: new Promise<void>((r) => (done = r)) });
    HTMLCanvasElement.prototype.toBlob = function (callback, ...rest) {
      const slow = first;
      first = false;
      return toBlob.call(
        this,
        (b) =>
          setTimeout(
            () => {
              callback(b);
              if (slow) queueMicrotask(() => done?.());
            },
            slow ? 600 : 0,
          ),
        ...rest,
      );
    };
  });
  await page.getByRole("button", { name: "X に投稿" }).click();
  await page.getByRole("button", { name: "フィルム" }).click();
  await page.evaluate(() => (window as unknown as { slowDone: Promise<void> }).slowDone);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  expect(
    await page.evaluate(() => (window as unknown as { shared: unknown[] }).shared.length),
  ).toBe(0);
});
