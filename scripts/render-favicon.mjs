/** OGPと同じラーメンのマークを、検索結果・ホーム画面用に描画する。 */
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const browser = await chromium.launch({ headless: true });
try {
  for (const [size, name] of [
    [96, "favicon-96.png"],
    [180, "apple-touch-icon.png"],
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.goto(new URL("../public/favicon.svg", import.meta.url).href);
    await page.locator("svg").evaluate((svg, dimension) => {
      svg.setAttribute("width", String(dimension));
      svg.setAttribute("height", String(dimension));
    }, size);
    await page.screenshot({ path: fileURLToPath(new URL(`../public/${name}`, import.meta.url)) });
    await page.close();
  }
} finally {
  await browser.close();
}
