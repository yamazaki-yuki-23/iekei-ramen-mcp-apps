// スライド HTML を 16:9 の PDF に書き出す（SpeakerDeck 投稿用）。
// 画面用 CSS は 100svh とスクロールスナップ前提なので、印刷時だけ
// 1 スライド = 1 ページ 720px 固定に上書きしてから page.pdf() を呼ぶ。
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 8765;
const OUT = ".slides/iekei-deck.pdf";

const server = spawn("python3", [".slides/serve.py"], { stdio: "ignore" });
const stop = () => server.kill();
process.on("exit", stop);

try {
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${PORT}/iekei-deck.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  // 背景色とフォントを印刷に載せるため screen メディアのまま出力する
  await page.emulateMedia({ media: "screen" });
  await page.addStyleTag({
    content: `
      @page { size: 1280px 720px; margin: 0; }
      html { scroll-snap-type: none !important; }
      .slide {
        min-height: 720px !important;
        height: 720px !important;
        break-after: page;
        break-inside: avoid;
      }
      .slide:last-child { break-after: auto; }
      /* 画面用のスクロール位置インジケータは紙では意味がない */
      .rail { display: none !important; }
    `,
  });

  const n = await page.locator(".slide").count();
  await page.pdf({ path: OUT, width: "1280px", height: "720px", printBackground: true });
  await browser.close();
  console.log(`${OUT} — ${n} スライド`);
} finally {
  stop();
}
