/**
 * 読み込み中のタブ操作。
 *
 * **押せることより、押した順に効くことが大事。** 追い越しを捨て損ねると、
 * 古い応答が後から届いて、押したタブから勝手に引き戻される。
 */
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
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

test("券売機の「近くで」の位置取得が遅れて返っても、移った地図から戻さない（#144）", async ({
  page,
}) => {
  const calls = await holdBrowserPosition(page);
  const app = await callTool(page, "decide-iekei-ramen");
  await waitForApp(app);
  await app.getByRole("button", { name: /^近くで/ }).click();
  await app.getByRole("button", { name: /^発券する/ }).click();
  await app.getByRole("tab", { name: "地図から探す" }).click();
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "0");
  await afterDelivered(
    app,
    app.locator("body").evaluate(() => window.iekeiPositionFixture.release("success")),
  );
  expect(calls).toEqual([]);
  await expect(app.getByRole("tab", { name: "地図から探す" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("券売機の位置取得を待つ間は取得中として扱い、前の結果の「次の 3 軒を見る」を押せない（#146）", async ({
  page,
}) => {
  /*
   * 位置待ちの間に前の結果の操作を許すと、遅れて届いた位置との順番争いになる
   * （#145 の 7 巡）。待つ間は取得中（busy）にして、押せないようにする。
   */
  await holdBrowserPosition(page);
  const app = await callTool(page, "decide-iekei-ramen", { prefecture: "神奈川県" });
  await waitForApp(app);
  await app.getByRole("button", { name: /^近くで/ }).click();
  await app.getByRole("button", { name: /^発券する/ }).click();
  await expect(app.getByRole("button", { name: "次の 3 軒を見る" })).toBeDisabled();
  await afterDelivered(
    app,
    app.locator("body").evaluate(() => window.iekeiPositionFixture.release("success")),
  );
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "0");
  await expect(app.getByRole("heading", { name: /（現在地）/ })).toBeVisible();
});

test("位置待ちの間に呼び出しの無いモードへ移ったら、取得中をすぐ外す（#146）", async ({ page }) => {
  await holdBrowserPosition(page);
  const app = await callTool(page, "decide-iekei-ramen");
  await waitForApp(app);
  await app.getByRole("button", { name: /^近くで/ }).click();
  await app.getByRole("button", { name: /^発券する/ }).click();
  // 基準地点の無い「現在地から」は tool を呼ばずに移る。位置はまだ返さない。
  await app.getByRole("tab", { name: "現在地から探す" }).click();
  await expect(app.getByRole("button", { name: "現在地で発券", exact: true })).toBeEnabled();
});

test("位置待ちの間にキーを押し直したら、発券を取り消して取得中をすぐ外す（#146）", async ({
  page,
}) => {
  await holdBrowserPosition(page);
  const app = await callTool(page, "decide-iekei-ramen", { prefecture: "神奈川県" });
  await waitForApp(app);
  await app.getByRole("button", { name: /^近くで/ }).click();
  await app.getByRole("button", { name: /^発券する/ }).click();
  await expect(app.getByRole("button", { name: "次の 3 軒を見る" })).toBeDisabled();
  // 位置はまだ返さない。キーの押し直しで発券は古くなる。
  await app.getByRole("button", { name: "クリーミー", exact: true }).click();
  await expect(app.getByRole("button", { name: "次の 3 軒を見る" })).toBeEnabled();
});

test("位置待ちの発券をキーで取り消したら、追い越した前の操作の後も表示中の食券を残す（#146）", async ({
  page,
}) => {
  await holdBrowserPosition(page);
  const app = await callTool(page, "decide-iekei-ramen", { prefecture: "神奈川県" });
  await waitForApp(app);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => (signalStarted = resolve));
  let held = false;
  await page.route(E2E_SERVER_URL, async (route) => {
    const body = route.request().postDataJSON();
    if (!held && body?.params?.name === "decide-iekei-ramen") {
      held = true;
      const response = await route.fetch();
      const text = await response.text();
      signalStarted();
      await gate;
      await route.fulfill({ response, body: text });
    } else await route.continue();
  });
  await app.getByRole("button", { name: /^近くで/ }).click();
  await app.getByRole("button", { name: "次の 3 軒を見る" }).click();
  await started;
  await app.getByRole("button", { name: /^発券する/ }).click();
  await app.getByRole("button", { name: "クリーミー", exact: true }).click();
  release();
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "0");
  await expect(app.getByRole("button", { name: "もう一度試す" })).toHaveCount(0);
  await expect(app.locator("button[data-shop-id]")).toHaveCount(3);
});

test("前から失敗の表示だったら、位置待ちの発券を取り消しても古い食券を戻さない（#146）", async ({
  page,
}) => {
  await holdBrowserPosition(page);
  const app = await callTool(page, "decide-iekei-ramen", { prefecture: "神奈川県" });
  await waitForApp(app);
  let failed = false;
  await page.route(E2E_SERVER_URL, async (route) => {
    const body = route.request().postDataJSON();
    if (!failed && body?.params?.name === "decide-iekei-ramen") {
      failed = true;
      await route.abort();
    } else await route.continue();
  });
  await app.getByRole("button", { name: /^近くで/ }).click();
  await app.getByRole("button", { name: "次の 3 軒を見る" }).click();
  await expect(app.getByRole("button", { name: "もう一度試す" })).toBeVisible();
  await app.getByRole("button", { name: /^発券する/ }).click();
  await app.getByRole("button", { name: "クリーミー", exact: true }).click();
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "0");
  await expect(app.getByRole("button", { name: "もう一度試す" })).toBeVisible();
  await expect(app.locator("button[data-shop-id]")).toHaveCount(0);
});

test("位置の許可を待つ間に前の操作の応答が届いても、後から押した「近くで」の発券が勝つ（#146）", async ({
  page,
}) => {
  await holdBrowserPosition(page);
  const app = await callTool(page, "decide-iekei-ramen");
  await waitForApp(app);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => (signalStarted = resolve));
  let held = false;
  await page.route(E2E_SERVER_URL, async (route) => {
    const body = route.request().postDataJSON();
    if (!held && body?.params?.name === "decide-iekei-ramen") {
      held = true;
      const response = await route.fetch();
      const text = await response.text();
      signalStarted();
      await gate;
      await route.fulfill({ response, body: text });
    } else await route.continue();
  });
  // 「近くで」を先に選び、そのあとに走らせた「次の 3 軒」の応答を位置待ちの間に返す
  // （キーの押し直しなら下書きの変化で捨てられるので、キーは先に選んでおく）。
  await app.getByRole("button", { name: /^近くで/ }).click();
  await app.getByRole("button", { name: "次の 3 軒を見る" }).click();
  await started;
  await app.getByRole("button", { name: /^発券する/ }).click();
  release();
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "0");
  // 捨てた応答の店を、位置待ちの間に選べない（取得中のまま）。
  await expect(app.getByText("読み込み中…", { exact: true })).toBeVisible();
  await expect(app.locator("button[data-shop-id]")).toHaveCount(0);
  await afterDelivered(
    app,
    app.locator("body").evaluate(() => window.iekeiPositionFixture.release("success")),
  );
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "0");
  await expect(app.getByRole("heading", { name: /（現在地）/ })).toBeVisible();
});

test("位置が取れないとき「近くで」は現在地の画面へ移らず、条件ごと現在地を探してもらう（#147）", async ({
  page,
}) => {
  await holdBrowserPosition(page);
  const decideArgs: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (request.url() !== E2E_SERVER_URL || request.method() !== "POST") return;
    const body = request.postDataJSON();
    if (body?.params?.name === "decide-iekei-ramen") decideArgs.push(body.params.arguments);
  });
  const app = await callTool(page, "decide-iekei-ramen");
  await waitForApp(app);
  await app.getByRole("button", { name: /^近くで/ }).click();
  await app.getByRole("button", { name: "クリーミー", exact: true }).click();
  await app.getByRole("button", { name: /^発券する/ }).click();
  await afterDelivered(
    app,
    app.locator("body").evaluate(() => window.iekeiPositionFixture.release("denied")),
  );
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "0");
  // E2E のサーバーはホストの位置も接続元の推定も持たないので、現在地は決まらない。
  expect(decideArgs.at(-1)).toMatchObject({ near: true, taste: "creamy" });
  await expect(app.getByText(/現在地が分かりませんでした。/)).toBeVisible();
  await expect(app.getByRole("tab", { name: "迷ったら" })).toHaveAttribute("aria-selected", "true");
  await expect(app.getByRole("button", { name: "クリーミー", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // 「近くで」も点いたまま。もう一度発券しても全国にはならず、near で頼み直す。
  await expect(app.getByRole("button", { name: /^近くで/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await app.getByRole("button", { name: /^発券する/ }).click();
  await afterDelivered(
    app,
    app.locator("body").evaluate(() => window.iekeiPositionFixture.release("denied")),
  );
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "0");
  expect(decideArgs.at(-1)).toMatchObject({ near: true, taste: "creamy" });
});

test("現在地が分からなかった「迷ったら」でキーワードを外しても、近くのまま頼み直す（#147）", async ({
  page,
}) => {
  const decideArgs: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (request.url() !== E2E_SERVER_URL || request.method() !== "POST") return;
    const body = request.postDataJSON();
    if (body?.params?.name === "decide-iekei-ramen") decideArgs.push(body.params.arguments);
  });
  const app = await callTool(page, "decide-iekei-ramen", { near: true, keyword: "家" });
  await waitForApp(app);
  await expect(app.getByText(/現在地が分かりませんでした。/)).toBeVisible();
  await app.getByRole("button", { name: "このキーワードを外す" }).click();
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "0");
  expect(decideArgs.at(-1)).toMatchObject({ near: true });
  await expect(app.getByText(/現在地が分かりませんでした。/)).toBeVisible();
});

test("現在地が分からなかった「迷ったら」のタブを押し直しても、近くのまま頼み直す（#147）", async ({
  page,
}) => {
  const decideArgs: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (request.url() !== E2E_SERVER_URL || request.method() !== "POST") return;
    const body = request.postDataJSON();
    if (body?.params?.name === "decide-iekei-ramen") decideArgs.push(body.params.arguments);
  });
  const app = await callTool(page, "decide-iekei-ramen", { near: true, taste: "creamy" });
  await waitForApp(app);
  await expect(app.getByText(/現在地が分かりませんでした。/)).toBeVisible();
  await app.getByRole("tab", { name: "迷ったら" }).click();
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "0");
  expect(decideArgs.at(-1)).toMatchObject({ near: true, taste: "creamy" });
  await expect(app.getByRole("button", { name: /^近くで/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("県と near を両方渡されて現在地が分からなかったら、券売機は「近くで」を点ける（#147）", async ({
  page,
}) => {
  const app = await callTool(page, "decide-iekei-ramen", { near: true, prefecture: "神奈川県" });
  await waitForApp(app);
  await expect(app.getByText(/現在地が分かりませんでした。/)).toBeVisible();
  await expect(app.getByRole("button", { name: /^近くで/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("食券が出る動きは最初の 3 枚だけ（#144）", async ({ page }) => {
  const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
  await waitForApp(app);
  const items = app.locator("ul:has(> li > button[data-shop-id]) > li");
  await expect(items.nth(3)).toBeVisible();
  const animation = (i: number) =>
    items.nth(i).evaluate((li) => getComputedStyle(li).animationName);
  expect(await animation(0)).not.toBe("none");
  expect(await animation(2)).not.toBe("none");
  expect(await animation(3)).toBe("none");
});

for (const outcome of ["success", "denied", "timeout"] as const) {
  test(`ブラウザ位置取得の${outcome}が遅れて返っても地図タブから戻らない`, async ({ page }) => {
    const calls = await holdBrowserPosition(page);
    const app = await callTool(page, "search-iekei-ramen");
    await waitForApp(app);
    await app.getByRole("tab", { name: "現在地から探す" }).click();
    await app.getByRole("button", { name: "現在地で発券", exact: true }).click();
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
    await app.getByRole("button", { name: "現在地で発券", exact: true }).click();
    await expect(app.getByText("現在地を取得中…", { exact: true })).toBeVisible();
    await app.getByRole("tab", { name: "地図から探す" }).click();
    await expect(app.locator("main[data-pending-calls]")).toHaveAttribute(
      "data-pending-calls",
      "0",
    );
    await app.getByRole("tab", { name: "現在地から探す" }).click();
    await app.getByRole("button", { name: "現在地で発券", exact: true }).click();
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
  await app.getByRole("button", { name: "現在地で発券", exact: true }).click();
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
  await app.getByRole("button", { name: "現在地で発券", exact: true }).click();
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
  await app.getByRole("button", { name: "この場所で発券" }).click();

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
