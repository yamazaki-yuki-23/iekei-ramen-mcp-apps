import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { appFrame, callTool, E2E_SERVER_URL, shopCards, waitForApp } from "./helpers";

test("タブだけの初期画面を完了扱いせず、tool結果を受け取ってから待機を終える", async ({ page }) => {
  await page.route(E2E_SERVER_URL, async (route) => {
    if (!route.request().postData()?.includes('"resources/read"')) return route.continue();
    const response = await route.fetch();
    const delay = `<script>
      window.releaseToolResult = () => {
        window.toolResultReleased = true;
        const e = window.heldToolResult;
        window.dispatchEvent(new MessageEvent('message', {data:e.data,source:e.source,origin:e.origin}));
      };
      window.addEventListener('message', e => {
        if (!window.toolResultReleased && e.data?.method === 'ui/notifications/tool-result') {
          window.heldToolResult = e;
          e.stopImmediatePropagation();
        }
      }, true);
    </script>`;
    const replace = (message: { result?: { contents?: Array<{ text: string }> } }) => {
      const content = message.result?.contents?.[0];
      if (content) content.text = content.text.replace("<head>", "<head>" + delay);
      return message;
    };
    const raw = await response.text();
    const body = response.headers()["content-type"]?.includes("text/event-stream")
      ? raw
          .split("\n")
          .map((line) =>
            line.startsWith("data: ")
              ? "data: " + JSON.stringify(replace(JSON.parse(line.slice(6))))
              : line,
          )
          .join("\n")
      : JSON.stringify(replace(JSON.parse(raw)));
    await route.fulfill({ response, body });
  });
  const app = await callTool(page, "decide-iekei-ramen");
  await expect(app.getByRole("tab", { name: "検索フォーム" })).toBeVisible();
  await expect
    .poll(() =>
      app
        .locator("body")
        .evaluate(() => Boolean((window as unknown as { heldToolResult: unknown }).heldToolResult)),
    )
    .toBe(true);
  // 実ホストからの通知を保留したまま、helper自身の期限で失敗する必要がある。
  await expect(waitForApp(app, 400)).rejects.toThrow("tool結果");
  await app
    .locator("body")
    .evaluate(() => (window as unknown as { releaseToolResult(): void }).releaseToolResult());
  await waitForApp(app);
  await expect(app.getByRole("tab", { name: "迷ったら", selected: true })).toBeVisible();
  await expect(shopCards(app)).toHaveCount(3);
});

test("実行contextが応答しない間も、countの無期限待ちをhelperへ持ち込まない", async ({ page }) => {
  const html =
    '<main data-tool-result-ready="true" data-mode="form"><button role="tab" aria-selected="true">検索フォーム</button></main>';
  await page.setContent("<iframe></iframe>");
  await page
    .frameLocator("iframe")
    .locator("body")
    .evaluate((body, source) => {
      const frame = document.createElement("iframe");
      frame.srcdoc = source;
      body.append(frame);
    }, html);
  const app = appFrame(page);
  await expect(app.getByRole("tab", { name: "検索フォーム" })).toBeVisible();
  const session = await page.context().newCDPSession(page);
  await session.send("Debugger.enable");
  const paused = new Promise<void>((resolve) => session.once("Debugger.paused", () => resolve()));
  try {
    await session.send("Debugger.pause");
    let countFinished = false;
    const oldCount = app.getByRole("tab", { name: "地図から探す", selected: true }).count();
    void oldCount.then(
      () => {
        countFinished = true;
      },
      () => {
        countFinished = true;
      },
    );
    await paused;
    await expect(waitForApp(app, 400)).rejects.toThrow("tool結果");
    expect(countFinished).toBe(false);
    await test.info().attach("startup-context-probe", {
      contentType: "application/json",
      body: JSON.stringify({
        contextPaused: true,
        legacyCountFinished: countFinished,
        helperTimeoutMs: 400,
        frameCount: page.frames().length,
      }),
    });
    await session.send("Debugger.resume");
    expect(await oldCount).toBe(0);
    await waitForApp(app);
  } finally {
    if (!page.isClosed()) {
      await session.send("Debugger.disable");
      await session.detach();
    }
  }
});

test("frame消失時の待機はhelperの期限で終わり、差し替え後は新しいframeを読む", async ({ page }) => {
  const inner =
    '<main data-tool-result-ready="true" data-mode="form"><button role="tab" aria-selected="true">検索フォーム</button></main>';
  await page.setContent("<iframe></iframe>");
  const outer = page.frameLocator("iframe");
  await outer.locator("body").evaluate((body, html) => {
    const frame = document.createElement("iframe");
    frame.srcdoc = html;
    body.append(frame);
  }, inner);
  const app = appFrame(page);
  await expect(app.getByRole("tab", { name: "検索フォーム" })).toBeVisible();
  await outer.locator("iframe").evaluate((frame) => frame.remove());
  const legacyCount = app.getByRole("tab", { name: "地図から探す", selected: true }).count();
  // frameが消えている間は準備完了にせず、helperの期限で終了する。
  await expect(waitForApp(app, 400)).rejects.toThrow("tool結果");
  await outer.locator("body").evaluate((body, html) => {
    const frame = document.createElement("iframe");
    frame.srcdoc = html;
    body.append(frame);
  }, inner);
  await waitForApp(app);
  expect(await legacyCount).toBe(0);
});
