/**
 * キーボードで押したあとの焦点と読み上げ（#156）。
 *
 * 結果が届くと画面は作り直され、押したボタンも消える。待つ間は disabled にもなる。
 * 焦点が body に落ちると、次の Tab が画面の先頭からやり直しになる。
 */
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { callTool, E2E_SERVER_URL, openMode, waitForApp } from "./helpers";

const WEB_URL = "http://localhost:3134";
const focusedText = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    return active === document.body ? "BODY" : (active?.textContent ?? "").trim();
  });
const settled = (page: Page) =>
  expect(page.locator("main")).toHaveAttribute("data-pending-calls", "0");

test("キーボードで「次の 3 軒」を押すと、焦点はそのボタンに残り、結果が読み上げの領域に入る", async ({
  page,
}) => {
  await page.goto(WEB_URL);
  await settled(page);
  await page.getByRole("button", { name: /次の 3 軒/ }).focus();
  await page.keyboard.press("Enter");
  await settled(page);
  await expect.poll(() => focusedText(page)).toBe("次の 3 軒を見る");
  await expect(page.getByRole("status").filter({ hasText: "軒中" })).toContainText("4〜6 軒目");
});

test("キーボードで探し方と「発券する」を押しても、焦点はそのボタンに残る", async ({ page }) => {
  await page.goto(WEB_URL);
  await settled(page);
  await page.getByRole("button", { name: "店名で", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => focusedText(page)).toBe("店名で");
  await settled(page);
  await page.locator("#kw").fill("家");
  await page.getByRole("button", { name: "発券する", exact: true }).focus();
  await page.keyboard.press("Enter");
  await settled(page);
  // 待つ間は「発券中…」になるので、名前でなく押した要素で追いかけている。
  await expect.poll(() => focusedText(page)).toBe("発券する");
});

test("会話の中のタブは、結果の領域と aria-controls で結び付いている", async ({ page }) => {
  const app = await callTool(page, "search-iekei-ramen");
  await waitForApp(app);
  const selected = app.getByRole("tab", { selected: true });
  const panelId = await selected.getAttribute("aria-controls");
  expect(panelId).toBeTruthy();
  const panel = app.locator(`#${panelId}`);
  await expect(panel).toHaveAttribute("role", "tabpanel");
  await expect(panel).toHaveAttribute("aria-labelledby", (await selected.getAttribute("id"))!);
});

test("最後の組で文言が「最初の 3 軒に戻る」に変わっても、キーボードの焦点はそのボタンに残る", async ({
  page,
}) => {
  // 固定 fixture の青森県は 2 組（3 軒と 1 軒）。1 回押すと最後の組になる。
  // fixture は 3133 が持つ（boundaries.spec.ts と同じ送り先の差し替え）。
  await page.route(E2E_SERVER_URL, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ response: await route.fetch({ url: "http://localhost:3133/mcp" }) });
  });
  const app = await callTool(page, "decide-iekei-ramen", { prefecture: "青森県" });
  await waitForApp(app);
  // 入れ子の iframe の中なので、要素へ直接キーを送る（Enter の click は detail が 0）。
  await app.getByRole("button", { name: "次の 3 軒を見る" }).press("Enter");
  const back = app.getByRole("button", { name: "最初の 3 軒に戻る" });
  await expect(back).toBeVisible();
  await expect(back).toBeFocused();
});

test("0 件の結果は見出しの件数で読み上げ、0 軒を 2 度読まない", async ({ page }) => {
  await page.goto(WEB_URL);
  await settled(page);
  await page.getByRole("button", { name: "店名で", exact: true }).click();
  // 「店名で」は検索を呼ぶ。返る前に打つと、その応答で入力した条件が使われない。
  await settled(page);
  await page.locator("#kw").fill("存在しない店名ZZZ");
  await page.getByRole("button", { name: "発券する", exact: true }).click();
  await settled(page);
  const announced = page.getByRole("status").filter({ hasText: "判定した結果の 0 軒" });
  await expect(announced).toHaveCount(1);
  await expect(announced).not.toContainText("見つかった店は 0 軒");
});

test("「現在地から」の地名欄で Enter を押しても、結果のあと焦点はその欄に残る", async ({
  page,
}) => {
  await page.goto(WEB_URL);
  await settled(page);
  await openMode(page, "nearby");
  const place = page.getByLabel("地名で指定");
  await place.fill("横浜駅");
  // 欄の Enter は click を起こさないので、キーで受けて追う（固定 fixture で解決する）。
  await place.press("Enter");
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("横浜駅");
  await expect(page.getByLabel("地名で指定")).toBeFocused();
});

test("現在地が分からず絞れなかった結果も読み上げる", async ({ page }) => {
  // 位置はすぐ断られる。E2E のサーバーはホストの位置も接続元の推定も持たない。
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, fail) =>
      fail?.({ code: 1, message: "denied" } as GeolocationPositionError);
  });
  const app = await callTool(page, "decide-iekei-ramen");
  await waitForApp(app);
  // 普通の「迷ったら」から、近くで発券して「現在地が分からない」へ入れ替える。
  await app.getByRole("button", { name: /^近くで/ }).click();
  await app.getByRole("button", { name: /^発券する/ }).click();
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "0");
  await expect(app.getByText(/現在地が分かりませんでした。/)).toBeVisible();
  await expect(
    app.getByRole("status").filter({ hasText: "現在地が分からず、店を絞れませんでした" }),
  ).toHaveCount(1);
});

test("待つ間にホストの入力欄へ移った焦点は、結果が届いても奪い返さない", async ({ page }) => {
  const app = await callTool(page, "decide-iekei-ramen");
  await waitForApp(app);
  // 次の呼び出しの応答だけを遅らせ、その間にホスト側へ焦点を移す。
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  await page.route(E2E_SERVER_URL, async (route) => {
    if (route.request().method() === "POST") await held;
    await route.continue();
  });
  await app.getByRole("button", { name: /次の 3 軒/ }).press("Enter");
  const hostInput = page.locator("textarea");
  await hostInput.focus();
  release();
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "0");
  await expect(hostInput).toBeFocused();
});

test("押したボタンがうまくいって消えたら、焦点はページの見出しへ移る", async ({ page }) => {
  const app = await callTool(page, "decide-iekei-ramen", { near: true, keyword: "家" });
  await waitForApp(app);
  // 「このキーワードを外す」は、外すと消える。戻す先が無いので見出しへ送る。
  await app.getByRole("button", { name: "このキーワードを外す" }).press("Enter");
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "0");
  await expect(app.getByRole("button", { name: "このキーワードを外す" })).toHaveCount(0);
  await expect(app.getByRole("heading", { level: 1 })).toBeFocused();
});

test("報告の欄で Enter を押して送っても、焦点を見出しへ運ばない", async ({ page }) => {
  // 報告は結果を差し替えない。欄が消えても、出たばかりの受付の文から離さない。
  await page.route(`${WEB_URL}/reports`, (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ message: "受け取りました。反映は確認してからなので時間がかかります" }),
    }),
  );
  await page.goto(WEB_URL);
  await settled(page);
  await openMode(page, "form");
  await settled(page);
  await page.getByLabel("キーワード").fill("存在しない試験店0123");
  await page.getByRole("button", { name: "発券する", exact: true }).click();
  await settled(page);
  await page.getByText("お探しの家系が見つからないときは", { exact: true }).click();
  await page.getByLabel("店名", { exact: true }).fill("試験家");
  const place = page.getByLabel("場所（駅名や住所）");
  await place.fill("横浜駅");
  await place.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "受け取りました" })).toBeVisible();
  // 見守りが動くとしたら、ここまでの数フレームの間に見出しへ運ぶ。
  await page.waitForTimeout(300);
  await expect(page.getByRole("heading", { level: 1 })).not.toBeFocused();
});

test("見出しと件数が前と同じでも、探し直した結果は読み上げる", async ({ page }) => {
  await page.goto(WEB_URL);
  await settled(page);
  await openMode(page, "form");
  await settled(page);
  // 読み上げの領域へ書いた回数を数える（同じ文でも、書けば読み上げの対象になる）。
  await page.evaluate(() => {
    const region = document.querySelector("#root > p[role=status]")!;
    (window as unknown as { writes: number }).writes = 0;
    new MutationObserver(() => (window as unknown as { writes: number }).writes++).observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  const writes = () => page.evaluate(() => (window as unknown as { writes: number }).writes);
  // 全国でどちらも 1 軒。見出しと件数は同じで、出る店だけが違う。
  for (const keyword of ["吉村家", "厚木家"]) {
    const before = await writes();
    await page.getByLabel("キーワード").fill(keyword);
    await page.getByRole("button", { name: "発券する", exact: true }).click();
    await settled(page);
    await expect.poll(writes).toBeGreaterThan(before);
  }
});

test("結果を入れ替えない札をキーボードで押しても、見守りを回し続けない", async ({ page }) => {
  // requestAnimationFrame の呼び出しを数える。見守りは毎フレーム 1 回呼ぶ。
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    (window as unknown as { rafs: number }).rafs = 0;
    window.requestAnimationFrame = (callback) => {
      (window as unknown as { rafs: number }).rafs++;
      return raf(callback);
    };
  });
  await page.goto(WEB_URL);
  await settled(page);
  const rafs = () => page.evaluate(() => (window as unknown as { rafs: number }).rafs);
  // 店の札は押しても結果を入れ替えない（選ぶだけ）。
  await page.locator("button[data-shop-id]").first().press("Enter");
  await page.waitForTimeout(1500);
  const before = await rafs();
  await page.waitForTimeout(1000);
  // 見守りが続いていれば 1 秒で約 60 回増える。止まっていればほとんど増えない。
  expect((await rafs()) - before).toBeLessThan(10);
});

test("位置の取得に時間がかかっても、キーボードで発券した焦点は発券の釦に戻る", async ({ page }) => {
  // 位置は 1.2 秒後に返る。呼び出しの前の待ちで、見守りをやめない。
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (ok) =>
      void setTimeout(
        () =>
          ok({
            coords: { latitude: 35.4658, longitude: 139.6222 },
            timestamp: Date.now(),
          } as GeolocationPosition),
        1200,
      );
  });
  // 会話の中は基準地点を持たずに始まるので、近くで発券すると位置を取りに行く。
  const app = await callTool(page, "decide-iekei-ramen");
  await waitForApp(app);
  await app.getByRole("button", { name: /^近くで/ }).click();
  const issue = app.getByRole("button", { name: /^発券する/ });
  // 結果が届くと画面ごと作り直される。それを待ってから見る（待つ間は焦点が残っていて当然）。
  const before = await app.locator("main").elementHandle();
  await issue.press("Enter");
  await expect
    .poll(() => before!.evaluate((el) => el.isConnected), { timeout: 10_000 })
    .toBe(false);
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "0");
  await expect(issue).toBeFocused();
});

test("「現在地から」で位置の取得に時間がかかっても、キーボードで押した「現在地で発券」に焦点が戻る", async ({
  page,
}) => {
  // 位置は 1.2 秒後に返る。この間は呼び出しの数に入らないので、data-busy で待っていると示す。
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (ok) =>
      void setTimeout(
        () =>
          ok({
            coords: { latitude: 35.4658, longitude: 139.6222 },
            timestamp: Date.now(),
          } as GeolocationPosition),
        1200,
      );
  });
  const app = await callTool(page, "find-nearby-iekei-ramen", { place: "横浜駅" });
  await waitForApp(app);
  const locate = app.getByRole("button", { name: "現在地で発券" });
  // 結果が届くと画面ごと作り直される。それを待ってから見る（待つ間は焦点が残っていて当然）。
  const before = await app.locator("main").elementHandle();
  await locate.press("Enter");
  await expect
    .poll(() => before!.evaluate((el) => el.isConnected), { timeout: 10_000 })
    .toBe(false);
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "0");
  await expect(locate).toBeFocused();
});

test("位置を待つ間に「現在地で発券」を押し直しても、新しい方の結果のあと焦点が戻る", async ({
  page,
}) => {
  // どの取得も 1.2 秒後に返る。押し直すと、前の取得が先に終わる。
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (ok) =>
      void setTimeout(
        () =>
          ok({
            coords: { latitude: 35.4658, longitude: 139.6222 },
            timestamp: Date.now(),
          } as GeolocationPosition),
        1200,
      );
  });
  const app = await callTool(page, "find-nearby-iekei-ramen", { place: "横浜駅" });
  await waitForApp(app);
  const locate = app.getByRole("button", { name: "現在地で発券" });
  const before = await app.locator("main").elementHandle();
  await locate.press("Enter");
  await app.locator("body").evaluate(() => new Promise((r) => setTimeout(r, 600)));
  await locate.press("Enter");
  await expect
    .poll(() => before!.evaluate((el) => el.isConnected), { timeout: 10_000 })
    .toBe(false);
  await expect(app.locator("main[data-pending-calls]")).toHaveAttribute("data-pending-calls", "0");
  await expect(locate).toBeFocused();
});
