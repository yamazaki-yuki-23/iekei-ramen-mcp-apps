/*
 * 家系タイプ診断（#167）のシェア画像を 8 枚作る（public/og/shindan-<タイプ>.png、1200×630）。
 * タイプ名か文言を変えたときだけ手で回し、できた画像をコミットする（ビルドでは作らない）。
 *
 *   node scripts/shindan-og.mjs
 */
import { mkdir, readdir, rm } from "node:fs/promises";
import { chromium } from "playwright";
import { rarity, TYPES } from "../src/lib/shindan.ts";
import { faceSvg } from "../src/lib/shindan-face.ts";

const out = new URL("../public/og/", import.meta.url);
await mkdir(out, { recursive: true });
// 前のタイプの画像を残さない。
for (const f of await readdir(out)) if (f.startsWith("shindan-")) await rm(new URL(f, out));
const font = "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const type of Object.values(TYPES)) {
  const r = rarity(type);
  // 激レアは虹色の光（ホログラム風）を表面に重ねる。
  const holo = `<div style="position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,transparent 20%,rgba(255,90,160,.16) 30%,rgba(255,210,80,.16) 38%,rgba(90,230,160,.16) 46%,rgba(80,170,255,.16) 54%,rgba(190,110,255,.16) 62%,transparent 72%)"></div>`;
  const badge =
    r === "激レア"
      ? "background:#d6a21e;border:3px solid #211814"
      : r === "レア"
        ? "background:#fff;border:4px solid #a9b4bf"
        : "background:#fff;border:3px solid #211814";
  await page.setContent(`<html><body style="margin:0;width:1200px;height:630px;background:#f3eee6;font-family:${font};color:#211814;display:grid;place-items:center">
  <div style="width:1100px;height:520px;box-sizing:border-box;display:grid;grid-template-columns:400px 1fr;gap:40px;align-items:center;padding:36px 48px;border:6px solid #211814;border-radius:32px;background:#fff;box-shadow:inset 0 0 0 10px #fff,inset 0 0 0 ${r === "激レア" ? 18 : 14}px ${r === "レア" ? "#a9b4bf" : "#d6a21e"},0 12px 0 #211814${r === "激レア" ? ",0 0 36px 8px rgba(214,162,30,.6)" : ""};position:relative;overflow:hidden">${r === "激レア" ? holo : ""}
    <div style="display:grid;place-items:center;height:100%;border-radius:22px;background:#fbeee8">${faceSvg(type.key, 340)}</div>
    <div style="display:flex;flex-direction:column;gap:22px">
      <div style="font-size:30px;font-weight:700;color:#6b5f57">家系タイプ診断</div>
      <div style="font-size:${type.name.length > 9 ? 54 : 70}px;font-weight:800;line-height:1.15;text-wrap:balance">${type.name}</div>
      <div style="font-size:32px;line-height:1.5;color:#4a403a;text-wrap:balance">${type.catch}</div>
      <div style="display:flex;align-items:center;gap:18px;font-size:28px;color:#6b5f57"><span style="${badge};border-radius:999px;padding:4px 22px;font-size:34px;font-weight:800;color:#211814">${r}</span>27 通りの注文のうち ${type.combos} 通り</div>
    </div>
  </div>
  <div style="position:absolute;right:60px;bottom:14px;font-size:24px;font-weight:700">iekeiramen.com</div></body></html>`);
  await page.screenshot({ path: new URL(`shindan-${type.key}.png`, out).pathname });
  console.log(`og/shindan-${type.key}.png`);
}
await browser.close();
