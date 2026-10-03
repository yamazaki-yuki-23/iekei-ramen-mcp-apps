/**
 * 読み込み中のタブ操作。
 *
 * **押せることより、押した順に効くことが大事。** 追い越しを捨て損ねると、
 * 古い応答が後から届いて、押したタブから勝手に引き戻される。
 */
import { expect, test, type Page } from "@playwright/test";
import { afterDelivered, callTool, E2E_SERVER_URL, waitForApp } from "./helpers";

type PositionOutcome = "success" | "denied" | "timeout";
declare global {
  interface Window {
    iekeiPositionFixture: {
      pending: Array<{ success: PositionCallback; failure?: PositionErrorCallback | null }>;
      release: (outcome: PositionOutcome) => Promise<void>;
    };
  }
}

async function holdBrowserPosition(page: Page) {
  await page.addInitScript(() => {
    const pending: Window["iekeiPositionFixture"]["pending"] = [];
    window.iekeiPositionFixture = {
      pending,
      release: async (outcome) => {
        const callback = pending.shift();
        if (!callback) throw new Error("保留された位置取得がありません");
        if (outcome === "success") {
          callback.success({
            coords: { latitude: 35.4658, longitude: 139.6222 },
            timestamp: Date.now(),
          } as GeolocationPosition);
        } else {
          callback.failure?.({
            code: outcome === "denied" ? 1 : 3,
            message: outcome,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          });
        }
        // Promiseの続きとReactの描画が進んだ後に返す。通信完了はafterDeliveredで待つ。
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      },
    };
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback, failure?: PositionErrorCallback | null) =>
          pending.push({ success, failure }),
      },
    });
  });
  const nearbyCalls: unknown[] = [];
  page.on("request", (request) => {
    if (request.url() !== E2E_SERVER_URL || request.method() !== "POST") return;
    const body = request.postDataJSON();
    if (body?.params?.name === "find-nearby-iekei-ramen") nearbyCalls.push(body.params.arguments);
  });
  return nearbyCalls;
}

for (const outcome of ["success", "denied", "timeout"] as const) {
  test(`ブラウザ位置取得の${outcome}が遅れて返っても地図タブから戻らない`, async ({ page }) => {
    const calls = await holdBrowserPosition(page);
    const app = await callTool(page, "search-iekei-ramen");
    await waitForApp(app);
    await app.getByRole("tab", { name: "現在地から探す" }).click();
    await app.getByRole("button", { name: "現在地から探す", exact: true }).click();
    await expect(app.getByText("現在地を取得中…", { exact: true })).toBeVisible();
    await app.getByRole("tab", { name: "地図から探す" }).click();
    await expect(app.locator("main[data-pending-calls]")).toHaveAttribute(
      "data-pending-calls",
      "0",
    );
    await expect(app.getByRole("tab", { name: "地図から探す" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await afterDelivered(
      app,
      app
        .locator("body")
        .evaluate((_, result) => window.iekeiPositionFixture.release(result), outcome),
    );
    expect(calls).toEqual([]);
    await expect(app.getByRole("tab", { name: "地図から探す" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test(`再マウント後の位置取得を古い${outcome}で上書きしない`, async ({ page }) => {
    const calls = await holdBrowserPosition(page);
    const app = await callTool(page, "search-iekei-ramen");
    await waitForApp(app);
    await app.getByRole("tab", { name: "現在地から探す" }).click();
    await app.getByRole("button", { name: "現在地から探す", exact: true }).click();
    await expect(app.getByText("現在地を取得中…", { exact: true })).toBeVisible();
    await app.getByRole("tab", { name: "地図から探す" }).click();
    await expect(app.locator("main[data-pending-calls]")).toHaveAttribute(
      "data-pending-calls",
      "0",
    );
    await app.getByRole("tab", { name: "現在地から探す" }).click();
    await app.getByRole("button", { name: "現在地から探す", exact: true }).click();
    await expect
      .poll(() => app.locator("body").evaluate(() => window.iekeiPositionFixture.pending.length))
      .toBe(2);
    await afterDelivered(
      app,
      app
        .locator("body")
        .evaluate((_, result) => window.iekeiPositionFixture.release(result), outcome),
    );
    expect(calls).toEqual([]);
    await expect(app.getByText("現在地を取得中…", { exact: true })).toBeVisible();
    await afterDelivered(
      app,
      app.locator("body").evaluate(() => window.iekeiPositionFixture.release("success")),
    );
    await expect(app.getByText("基準: 現在地", { exact: true })).toBeVisible();
    expect(calls).toHaveLength(1);
  });
}

test("現在地タブに留まればブラウザの拒否後もホスト位置で探せる", async ({ page }) => {
  const calls = await holdBrowserPosition(page);
  await page.route(E2E_SERVER_URL, async (route) => {
    const body = route.request().postDataJSON();
    if (body?.params?.name !== "find-nearby-iekei-ramen") return route.continue();
    // ホストが添える位置だけを固定し、店舗検索は実サーバーへ渡す。
    body.params._meta = {
      "openai/userLocation": { latitude: 35.4658, longitude: 139.6222, city: "横浜市" },
    };
    const response = await route.fetch({ postData: JSON.stringify(body) });
    await route.fulfill({ response });
  });
  const app = await callTool(page, "search-iekei-ramen");
  await waitForApp(app);
  await app.getByRole("tab", { name: "現在地から探す" }).click();
  await app.getByRole("button", { name: "現在地から探す", exact: true }).click();
  await afterDelivered(
    app,
    app.locator("body").evaluate(() => window.iekeiPositionFixture.release("denied")),
  );
  await expect(app.getByText(/基準: 横浜市/)).toBeVisible();
  expect(calls).toEqual([{ limit: 5 }]);
});

test("ホスト位置検索を待つ間にタブを移っても古い案内文を残さない", async ({ page }) => {
  await holdBrowserPosition(page);
  const app = await callTool(page, "search-iekei-ramen");
  await waitForApp(app);
  const { delivered } = await delayResponse(page, "find-nearby-iekei-ramen", 2500);
  await app.getByRole("tab", { name: "現在地から探す" }).click();
  await app.getByRole("button", { name: "現在地から探す", exact: true }).click();
  await app.locator("body").evaluate(() => window.iekeiPositionFixture.release("denied"));
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "1");
  await app.getByRole("tab", { name: "地図から探す" }).click();
  await afterDelivered(app, delivered);
  await expect(app.getByRole("tab", { name: "地図から探す" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await app.getByRole("tab", { name: "現在地から探す" }).click();
  await expect(
    app.getByText("現在地を取得できませんでした。下の欄に地名を入力してください。", {
      exact: true,
    }),
  ).toHaveCount(0);
});

/**
 * その tool の応答だけを遅らせる。サーバーには先に届かせ、処理の順番は変えない。
 *
 * 返すのは、遅らせた応答をホストへ渡し終えた合図。**時間で待たず、これを待つ。**
 * 遅らせた時間より長めに待つ書き方では、遅い CI で応答がまだ届いておらず、
 * 引き戻されるかどうかを見ないまま通ってしまう。
 *
 * **合図は包んで返す。** async 関数から Promise をそのまま返すと外側に合流し、
 * 届くまで解けなくなる。届くのは呼び出し側がこの後でタブを押してからなので、
 * 互いに待ち合って止まる（実際にそうなり、60 秒で切れた）。
 */
async function delayResponse(
  page: Page,
  tool: string,
  ms: number,
): Promise<{ delivered: Promise<void> }> {
  let delivered!: () => void;
  const done = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  await page.route(`**/${E2E_SERVER_URL.split("//")[1]}`, async (route) => {
    const body = route.request().postData() ?? "";
    if (body.includes(`"${tool}"`)) {
      const response = await route.fetch();
      const text = await response.text();
      await new Promise((resolve) => setTimeout(resolve, ms));
      await route.fulfill({ response, body: text });
      delivered();
      return;
    }
    await route.continue();
  });
  return { delivered: done };
}

test("読み込み中でもタブを押せて、最後に押したタブの結果になる", async ({ page }) => {
  const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
  await waitForApp(app);

  // 地図の応答を遅らせ、返る前に「迷ったら」へ移る。
  const { delivered: lateMap } = await delayResponse(page, "show-iekei-ramen-map", 2500);
  await app.getByRole("tab", { name: "地図から探す" }).click();
  await expect(app.getByRole("tab", { name: "地図から探す" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await app.getByRole("tab", { name: "迷ったら" }).click();
  await expect(app.getByRole("heading", { level: 1 })).toContainText("迷ったら");

  /*
   * **遅れて届く地図の応答で引き戻されないこと。** 届き切ってから見る——
   * 届く前に見ると、引き戻される前の状態に一致して通ってしまう。
   */
  await afterDelivered(app, lateMap);
  await expect(app.getByRole("tab", { name: "迷ったら" })).toHaveAttribute("aria-selected", "true");
  await expect(app.getByRole("heading", { level: 1 })).toContainText("迷ったら");
});

test("tool を呼ばないタブへ移っても、前の呼び出しに引き戻されない", async ({ page }) => {
  /*
   * 匿名の「行った店」は tool を呼ばない（401 を受けてもホストはサインインの
   * 画面を出さないため）。呼ばない移り方では通し番号が進まないので、
   * 走っている呼び出しを捨てておかないと、届いた payload でモードが戻る。
   */
  const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
  await waitForApp(app);

  const { delivered: lateMap } = await delayResponse(page, "show-iekei-ramen-map", 2500);
  await app.getByRole("tab", { name: "地図から探す" }).click();
  await app.getByRole("tab", { name: "行った店" }).click();
  await expect(app.getByRole("button", { name: "チャットでサインインする" })).toBeVisible();

  await afterDelivered(app, lateMap);
  await expect(app.getByRole("tab", { name: "行った店" })).toHaveAttribute("aria-selected", "true");
  await expect(app.getByRole("button", { name: "チャットでサインインする" })).toBeVisible();
});

test("地名の解決を待つ間にタブを移っても、現在地へ引き戻されない", async ({ page }) => {
  /*
   * 地名の解決（geocode-place）は一覧を差し替えないので通し番号が進まない。
   * 解決と現在地検索を別々に扱うと、**あとから検索だけが走って**押したタブから
   * 引き戻される。
   */
  const app = await callTool(page, "find-nearby-iekei-ramen", { limit: 5 });
  await waitForApp(app);

  const { delivered: lateGeocode } = await delayResponse(page, "geocode-place", 2500);
  await app.getByLabel("地名で指定").fill("横浜駅");
  await app.getByRole("button", { name: "この場所で探す" }).click();

  // 解決を待っている間に別のタブへ移る。
  await app.getByRole("tab", { name: "検索フォーム" }).click();
  await expect(app.getByRole("tab", { name: "検索フォーム" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // 遅れて解決が届いても、現在地モードへは戻らない。届き切ってから見る。
  await afterDelivered(app, lateGeocode);
  await expect(app.getByRole("tab", { name: "検索フォーム" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
