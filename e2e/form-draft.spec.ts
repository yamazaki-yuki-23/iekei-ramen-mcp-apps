import { expect, type Page, type FrameLocator } from "@playwright/test";
import { test } from "./fixtures";
import { callTool, waitForApp, E2E_SERVER_URL } from "./helpers";

const WEB_URL = "http://localhost:3134";
type Surface = Page | FrameLocator;

async function openDecide(page: Page, web: boolean): Promise<Surface> {
  if (!web) {
    const app = await callTool(page, "decide-iekei-ramen");
    await waitForApp(app);
    return app;
  }
  await page.goto(WEB_URL);
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
  return page;
}

/** 最初の検索応答を明示的に保留・解放し、固定時間に依存せず入力と応答を競合させる。 */
async function holdSearch(page: Page, url: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  let signalDelivered!: () => void;
  const delivered = new Promise<void>((resolve) => {
    signalDelivered = resolve;
  });
  let held = false;
  await page.route(url, async (route) => {
    const body = route.request().postDataJSON();
    if (!held && body?.method === "tools/call" && body.params?.name === "search-iekei-ramen") {
      held = true;
      const response = await route.fetch();
      const text = await response.text();
      signalStarted();
      await gate;
      await route.fulfill({ response, body: text });
      signalDelivered();
    } else await route.continue();
  });
  return { started, release, delivered };
}

for (const web of [true, false]) {
  const name = web ? "Web" : "MCP Apps";
  const url = web ? `${WEB_URL}/mcp` : E2E_SERVER_URL;

  test(`${name}: タブ切り替え中に入力した条件を保持し、その条件で検索できる`, async ({ page }) => {
    const app = await openDecide(page, web);
    const held = await holdSearch(page, url);
    try {
      await app.getByRole("tab", { name: "検索フォーム" }).click();
      await held.started;
      await expect(app.locator("main")).toHaveAttribute("data-pending-calls", "1");
      await app.getByLabel("キーワード").fill("吉村");
      await app.getByLabel("都道府県").selectOption("神奈川県");
      await app.getByRole("button", { name: "直系・濃厚", exact: true }).click();
      held.release();
      await held.delivered;
      await expect(app.locator("main")).toHaveAttribute("data-pending-calls", "0");
      await expect(app.getByLabel("キーワード")).toHaveValue("吉村");
      await expect(app.getByLabel("都道府県")).toHaveValue("神奈川県");
      await expect(app.getByRole("button", { name: "直系・濃厚", exact: true })).toHaveClass(
        /chipActive/,
      );
      await app.getByRole("button", { name: "検索", exact: true }).click();
      await expect(app.locator("button[data-shop-id]")).toHaveCount(1);
      await expect(app.locator("button[data-shop-id]").first()).toContainText("吉村家");
      await expect(app.getByLabel("キーワード")).toHaveValue("吉村");
    } finally {
      held.release();
    }
  });

  test(`${name}: 送信後に消したキーワードを、古い検索応答で復元しない`, async ({ page }) => {
    const app = await openDecide(page, web);
    await app.getByRole("tab", { name: "検索フォーム" }).click();
    await expect(app.locator("main")).toHaveAttribute("data-pending-calls", "0");
    await app.getByLabel("キーワード").fill("吉村");
    const held = await holdSearch(page, url);
    try {
      await app.getByRole("button", { name: "検索", exact: true }).click();
      await held.started;
      await app.getByLabel("キーワード").fill("");
      held.release();
      await held.delivered;
      await expect(app.locator("main")).toHaveAttribute("data-pending-calls", "0");
      await expect(app.getByLabel("キーワード")).toHaveValue("");
      await app.getByRole("button", { name: "検索", exact: true }).click();
      await expect(app.locator("button[data-shop-id]")).toHaveCount(200);
    } finally {
      held.release();
    }
  });
}

test("MCP Apps: モデルの新しいqueryを反映し、その後に届く旧UI応答で戻さない", async ({
  page,
  request,
}) => {
  await page.route(E2E_SERVER_URL, async (route) => {
    if (!route.request().postData()?.includes('"resources/read"')) return route.continue();
    const response = await route.fetch();
    const fixture = `<script>
      window.addEventListener('message', event => {
        if (event.data?.method !== 'ui/notifications/tool-result') return;
        window.receiveHostResult = result => window.dispatchEvent(new MessageEvent('message', {
          source: event.source, origin: event.origin,
          data: {...event.data, params: result}
        }));
      }, true);
    </script>`;
    const body = (await response.text())
      .split("\n")
      .map((line) => {
        if (!line.startsWith("data: ")) return line;
        const message = JSON.parse(line.slice(6));
        const content = message.result?.contents?.[0];
        if (content) content.text = content.text.replace("<head>", "<head>" + fixture);
        return "data: " + JSON.stringify(message);
      })
      .join("\n");
    await route.fulfill({ response, body });
  });
  const app = await callTool(page, "decide-iekei-ramen");
  await waitForApp(app);
  const held = await holdSearch(page, E2E_SERVER_URL);
  try {
    await app.getByRole("tab", { name: "検索フォーム" }).click();
    await held.started;
    await app.getByLabel("キーワード").fill("武蔵");
    const response = await request.post(E2E_SERVER_URL, {
      headers: { Accept: "application/json, text/event-stream" },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "search-iekei-ramen",
          arguments: { keyword: "吉村", prefecture: "神奈川県" },
        },
      },
    });
    expect(response.status()).toBe(200);
    const raw = await response.text();
    const data = raw.split("\n").find((line) => line.startsWith("data: "));
    expect(data).toBeTruthy();
    const result = JSON.parse(data!.slice(6)).result;
    expect(result.structuredContent.query.keyword).toBe("吉村");
    // 実MCPの結果を、ホストからの通知と同じSDK経路に渡す。
    await app.locator("body").evaluate((_body, notification) => {
      (window as unknown as { receiveHostResult: (result: unknown) => void }).receiveHostResult(
        notification,
      );
    }, result);
    await expect(app.getByLabel("キーワード")).toHaveValue("吉村");
    await expect(app.getByLabel("都道府県")).toHaveValue("神奈川県");
    held.release();
    await held.delivered;
    await expect(app.locator("main")).toHaveAttribute("data-pending-calls", "0");
    await expect(app.getByLabel("キーワード")).toHaveValue("吉村");
    await expect(app.getByLabel("都道府県")).toHaveValue("神奈川県");
    await expect(app.locator("button[data-shop-id]")).toHaveCount(1);
  } finally {
    held.release();
  }
});
