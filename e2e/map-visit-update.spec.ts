import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { build } from "vite";
import type { MapTestApi } from "./fixtures/map-view-harness";

let script: string;
let css: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [
      {
        name: "count-clustering",
        transform(code, id) {
          if (!id.endsWith("/src/features/search/utils/cluster.ts")) return;
          // 本番ソースは変えず、テスト用バンドルだけで再計算の回数を測る。
          return code.replace("const cells =", "window.mapTest.counts.clusters++; const cells =");
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL("./fixtures/map-view-harness.tsx", import.meta.url)),
        name: "MapTest",
        formats: ["iife"],
      },
    },
  });
  const bundle = Array.isArray(result) ? result[0] : result;
  if (!("output" in bundle)) throw new Error("ブラウザ用ビルドの出力がありません");
  script = bundle.output
    .filter((item) => item.type === "chunk")
    .map((item) => item.code)
    .join("\n");
  css = bundle.output
    .filter((item) => item.type === "asset" && item.fileName.endsWith(".css"))
    .map((item) => item.source)
    .join("\n");
});

test("訪問印だけの更新はクラスタとピンを保持し、焦点・画角・読み上げを維持する", async ({
  page,
}) => {
  page.on("pageerror", (error) => console.error(error.message));
  // 地図のデータと文字は取りに行かない（外部に問い合わせない）。ピンと塊は GeoJSON なので描ける。
  await page.route("**/map/**", (route) => route.abort());
  /*
   * 先に http のページを開いてから中身を差し替える。about:blank では、地図の描画に使う Worker
   * （blob: から起動する ES モジュール）を読み込めない。本物の画面は http(s) の場所で動く。
   */
  await page.goto("/");
  await page.setContent('<div id="root" style="width:800px;height:600px"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await page.waitForFunction(() => (window.mapTest.counts.markers ?? 0) > 0);
  const name = await page.evaluate(() => window.mapTest.shop.name);
  const pin = page.getByRole("button", { name: new RegExp(`^${name}、`) });
  await expect(pin).toHaveCount(1);
  // 同一DOM要素を保持することを調べる。古い要素が消えても通るロケータでは測らない。
  const element = await pin.elementHandle();
  await pin.focus();
  const bounds = () =>
    page.evaluate(() => window.mapTest.map!.getBounds().toArray().flat().join(","));
  const before = {
    counts: await page.evaluate(() => ({ ...window.mapTest.counts })),
    bounds: await bounds(),
  };
  expect(before.counts.clusters).toBeGreaterThan(0);
  // クラスタのDOMもページ内に保持し、更新後に同じ要素か照合する。
  await page.evaluate(() => {
    Object.assign(window.mapTest, {
      clusterElements: [...document.querySelectorAll(".cluster-pin")],
    });
  });
  expect(await page.locator(".cluster-pin").count()).toBeGreaterThan(0);
  const update = async (visited: boolean) => {
    const version = await page.evaluate(() => window.mapTest.commits);
    await page.evaluate((value) => window.mapTest.visit(value), visited);
    await page.waitForFunction((value) => window.mapTest.commits > value, version);
  };
  await update(true);
  await expect(pin).toHaveAttribute("aria-label", new RegExp("行った店"));
  await expect(pin).toHaveAttribute("data-visited", "true");
  const after = await page.evaluate(() => ({ ...window.mapTest.counts }));
  expect(await element!.evaluate((el) => el.isConnected && document.activeElement === el)).toBe(
    true,
  );
  expect(await bounds()).toBe(before.bounds);
  // 行った印は地図の部品のデータを差し替えるだけ。塊の計算も、印の DOM も作り直さない。
  expect(after.clusters - before.counts.clusters).toBe(0);
  expect(after.markers - before.counts.markers).toBe(0);
  expect(
    await page.evaluate(() => {
      const api = window.mapTest as MapTestApi & { clusterElements: Element[] };
      return api.clusterElements.every(
        (el, i) => el === document.querySelectorAll(".cluster-pin")[i],
      );
    }),
  ).toBe(true);
  // 焦点のあるピンの札にも、行ったことが出る。
  await expect(page.locator(".map-tip")).toContainText("行った店");
  // 同じ訪問状態を別のSetで渡しても、作り直さない。
  await update(true);
  expect(await page.evaluate(() => window.mapTest.counts)).toEqual(after);
  await update(false);
  await expect(pin).not.toHaveAttribute("aria-label", new RegExp("行った店"));
  await expect(page.locator(".map-tip")).not.toContainText("行った店");
  expect(await page.evaluate(() => window.mapTest.counts)).toEqual(after);
  expect(await element!.evaluate((el) => el.isConnected && document.activeElement === el)).toBe(
    true,
  );

  // 選択・ズーム・店舗変更では必要な描き直しを続ける。
  await pin.press("Enter");
  const selected = page.locator(".shop-pin-selected");
  await expect(selected).toHaveCount(1);
  await expect(selected).toBeFocused();
  const selectedBefore = await page.evaluate(() => ({ ...window.mapTest.counts }));
  await update(true);
  await expect(selected).toBeFocused();
  await expect(selected).toHaveAttribute("data-visited", "true");
  await expect(page.locator(".map-tip")).toContainText("行った店");
  expect(await page.evaluate(() => window.mapTest.counts.clusters)).toBe(selectedBefore.clusters);
  await update(false);
  await expect(selected).toBeFocused();
  await expect(page.locator(".map-tip")).not.toContainText("行った店");
  await update(true);
  await page.evaluate(() => window.mapTest.map!.setZoom(window.mapTest.map!.getZoom() + 1));
  await page.waitForFunction(
    (value) => window.mapTest.counts.clusters > value,
    selectedBefore.clusters,
  );
  await expect(selected).toHaveAttribute("aria-label", new RegExp("行った店"));
  await expect(selected).toBeFocused();
  const version = await page.evaluate(() => window.mapTest.commits);
  await page.evaluate(() => window.mapTest.filter());
  await page.waitForFunction((value) => window.mapTest.commits > value, version);
  await expect(page.locator(".cluster-pin")).toHaveCount(0);
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAttribute("aria-label", new RegExp("行った店"));
});
