import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
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
          if (!id.endsWith("/src/lib/cluster.ts")) return;
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
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await page.waitForFunction(() => window.mapTest.map?.getZoom() === 14);
  const name = await page.evaluate(() => window.mapTest.shop.name);
  const pin = page.getByRole("button", { name: new RegExp(`^${name}（`) });
  await expect(pin).toHaveCount(1);
  // 同一DOM要素を保持することを調べる。古い要素が消えても通るロケータでは測らない。
  const element = await pin.elementHandle();
  await pin.focus();
  const before = await page.evaluate(() => ({
    counts: { ...window.mapTest.counts },
    bounds: window.mapTest.map!.getBounds().toBBoxString(),
  }));
  expect(before.counts.clusters).toBeGreaterThan(0);
  // クラスタのDOMもページ内に保持し、更新後に同じ要素か照合する。
  await page.evaluate(() => {
    Object.assign(window.mapTest, {
      clusterElements: [...document.querySelectorAll(".cluster-pin")],
    });
  });
  const update = async (visited: boolean) => {
    const version = await page.evaluate(() => window.mapTest.commits);
    await page.evaluate((value) => window.mapTest.visit(value), visited);
    await page.waitForFunction((value) => window.mapTest.commits > value, version);
  };
  await update(true);
  await expect(pin).toHaveAttribute("aria-label", new RegExp("行った"));
  const after = await page.evaluate(() => ({ ...window.mapTest.counts }));
  console.info(
    JSON.stringify({
      shops: await page.evaluate(() => window.mapTest.shopCount),
      zoom: 14,
      recreatedCircles: after.circles - before.counts.circles,
      recreatedClusterMarkers: after.markers - before.counts.markers,
      clusterCalculations: after.clusters - before.counts.clusters,
    }),
  );
  expect(await element!.evaluate((el) => el.isConnected && document.activeElement === el)).toBe(
    true,
  );
  expect(await page.evaluate(() => window.mapTest.map!.getBounds().toBBoxString())).toBe(
    before.bounds,
  );
  expect(after.clusters - before.counts.clusters).toBe(0);
  expect(after.markers - before.counts.markers).toBe(0);
  expect(after.circles - before.counts.circles).toBe(1); // 追加する白い点だけ。
  expect(
    await page.evaluate(() => {
      const api = window.mapTest as MapTestApi & { clusterElements: Element[] };
      return api.clusterElements.every(
        (el, i) => el === document.querySelectorAll(".cluster-pin")[i],
      );
    }),
  ).toBe(true);
  // 同じ訪問状態を別のSetで渡しても、白い点を作り直さない。
  await update(true);
  expect(await page.evaluate(() => window.mapTest.counts)).toEqual(after);
  await update(false);
  await expect(pin).not.toHaveAttribute("aria-label", new RegExp("行った"));
  expect(await page.evaluate(() => window.mapTest.counts)).toEqual(after);
  expect(await element!.evaluate((el) => el.isConnected && document.activeElement === el)).toBe(
    true,
  );
  const paths = await page.locator(".leaflet-overlay-pane path").count();
  await update(true);
  expect(await page.locator(".leaflet-overlay-pane path").count()).toBe(paths + 1);
  await update(false);
  expect(await page.locator(".leaflet-overlay-pane path").count()).toBe(paths);

  // 選択・ズーム・店舗変更では必要な描き直しを続ける。
  await pin.press("Enter");
  const selected = page.locator(".leaflet-selectedShop-pane [role=button]");
  await expect(selected).toHaveCount(1);
  await expect(selected).toBeFocused();
  const selectedBefore = await page.evaluate(() => ({ ...window.mapTest.counts }));
  await update(true);
  await expect(selected).toBeFocused();
  expect(await page.locator(".leaflet-selectedShop-pane path").count()).toBe(2);
  await expect(page.locator(".leaflet-selectedShop-pane path").last()).toHaveAttribute(
    "fill",
    "#ffffff",
  );
  const tooltipId = await selected.getAttribute("aria-describedby");
  const tooltip = page.locator(`[id="${tooltipId}"]`);
  await expect(tooltip).toContainText("行った");
  expect(await page.evaluate(() => window.mapTest.counts.clusters)).toBe(selectedBefore.clusters);
  await update(false);
  await expect(selected).toBeFocused();
  await expect(page.locator(".leaflet-selectedShop-pane path")).toHaveCount(1);
  await expect(tooltip).not.toContainText("行った");
  await update(true);
  await page.evaluate(() => window.mapTest.map!.setZoom(15, { animate: false }));
  await page.waitForFunction(
    (value) => window.mapTest.counts.clusters > value,
    selectedBefore.clusters,
  );
  await expect(selected).toHaveAttribute("aria-label", new RegExp("行った"));
  await expect(selected).toBeFocused();
  const version = await page.evaluate(() => window.mapTest.commits);
  await page.evaluate(() => window.mapTest.filter());
  await page.waitForFunction((value) => window.mapTest.commits > value, version);
  await expect(page.locator(".cluster-pin")).toHaveCount(0);
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAttribute("aria-label", new RegExp("行った"));
});
