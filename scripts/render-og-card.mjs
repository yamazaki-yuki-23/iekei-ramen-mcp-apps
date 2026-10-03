/** 静的OGP画像を作り直す。配信時には実行しない。 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const source = new URL("./og-card.svg", import.meta.url);
const output = new URL("../public/og-card.png", import.meta.url);
await mkdir(new URL("../public/", import.meta.url), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.goto(source.href);
  await page.screenshot({ path: fileURLToPath(output) });
} finally {
  await browser.close();
}
