import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { callTool, waitForApp } from "./helpers";

const WEB_URL = "http://localhost:3134";

test("初回は家系の3行説明を開き、次回は畳む。候補を変えても開閉は保つ", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(WEB_URL);
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
  const intro = page.locator('details[aria-label="家系とは"]');
  const summary = intro.locator(":scope > summary");
  await expect(intro).toHaveAttribute("open", "");
  await expect(intro.getByText("豚骨醤油と太めの麺が定番です。", { exact: true })).toBeVisible();
  await expect(intro.getByText("迷ったら、まず3軒から見てみよう。", { exact: true })).toBeVisible();
  await expect(intro.getByText("家系判定と味の分類は推定です。", { exact: true })).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("data-mode", "decide");
  await expect(page.getByRole("tab").first()).toHaveText("迷ったら");
  await expect(page.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("button[data-shop-id]")).toHaveCount(3);

  await intro.getByText("直系・資本系・インスパイア系とは", { exact: true }).click();
  for (const term of ["直系", "資本系", "インスパイア系"]) {
    await expect(intro.locator("dt").filter({ hasText: term })).toBeVisible();
  }
  await intro.getByText("注文のしかた（お好み・卓上・ライス）", { exact: true }).click();
  await expect(intro.getByRole("columnheader", { name: "聞かれること" })).toBeVisible();
  await expect(intro).toContainText("お店の掲示に従ってください");

  await summary.focus();
  await summary.press("Enter");
  await expect(intro).not.toHaveAttribute("open", "");
  await summary.press("Enter");
  await expect(intro).toHaveAttribute("open", "");
  await page.getByRole("button", { name: "別の候補を見る" }).click();
  await expect(page.getByText(/^2 \/ \d+ 巡目$/)).toBeVisible();
  await expect(intro).toHaveAttribute("open", "");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);

  await page.reload();
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
  await expect(intro).not.toHaveAttribute("open", "");
  await summary.click();
  await expect(intro).toHaveAttribute("open", "");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(intro).toHaveAttribute("open", "");
});

test("localStorageが使えなくても説明を畳み、候補を切り替えられる", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage unavailable", "SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(WEB_URL);
  await expect(page.locator("main[data-tool-result-ready=true]")).toBeVisible();
  const intro = page.locator('details[aria-label="家系とは"]');
  await expect(intro).toHaveAttribute("open", "");
  await intro.locator(":scope > summary").click();
  await expect(intro).not.toHaveAttribute("open", "");
  await page.getByRole("button", { name: "別の候補を見る" }).click();
  await expect(page.getByText(/^2 \/ \d+ 巡目$/)).toBeVisible();
  await expect(intro).not.toHaveAttribute("open", "");
  await expect(page.locator("button[data-shop-id]")).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("MCP Appsは説明を追加せず、検索フォームから始まる", async ({ page }) => {
  const app = await callTool(page, "search-iekei-ramen");
  await waitForApp(app);
  await expect(app.locator('details[aria-label="家系とは"]')).toHaveCount(0);
  await expect(app.getByRole("tab").first()).toHaveText("検索フォーム");
  await expect(app.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
});
