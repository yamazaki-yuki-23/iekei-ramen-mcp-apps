/**
 * アイコン一式を描画する（#130）。配信時には実行しない。
 *
 * 小さいもの（タブ・検索結果）は海苔だけの public/favicon.svg、
 * 大きいもの（ホーム画面・ディレクトリ）はロゴそのものの scripts/icons/logo-icon.svg から作る。
 * ロゴは 16px でピンと丼が潰れるため、大きさで描き分ける（#123 の確認事項）。
 */
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const browser = await chromium.launch({ headless: true });
try {
  for (const [size, name, source] of [
    [96, "favicon-96.png", "../public/favicon.svg"],
    [180, "apple-touch-icon.png", "./icons/logo-icon.svg"],
    [512, "icon-512.png", "./icons/logo-icon.svg"],
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.goto(new URL(source, import.meta.url).href);
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
