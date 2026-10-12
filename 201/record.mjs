// 家系タイプ診断の紹介動画（#201）の素材を本番から撮る。CDP のスクリーンショットを続けて撮り、時刻を壁時計で残す。
import { chromium } from "playwright";
import fs from "node:fs";
const OUT = process.argv[2];
fs.mkdirSync(`${OUT}/frames`, { recursive: true });
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 405, height: 720 }, deviceScaleFactor: 1080 / 405 });
await c.addInitScript(() => {
  document.addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    Object.assign(dot.style, { position: "fixed", left: "0", top: "0", width: "52px", height: "52px", margin: "-26px 0 0 -26px", borderRadius: "50%", background: "rgba(255,255,255,0.55)", border: "4px solid rgba(40,30,25,0.75)", boxShadow: "0 2px 10px rgba(0,0,0,0.3)", pointerEvents: "none", zIndex: "99999", opacity: "0", transition: "opacity 120ms, transform 120ms", transform: "scale(0.6)" });
    document.body.appendChild(dot);
    const at = (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; };
    addEventListener("pointerdown", (e) => { at(e); dot.style.opacity = "1"; dot.style.transform = "scale(1)"; }, true);
    addEventListener("pointerup", () => setTimeout(() => { dot.style.opacity = "0"; dot.style.transform = "scale(0.6)"; }, 120), true);
  });
});
const p = await c.newPage();
await p.goto("https://iekeiramen.com/shindan/");
await p.getByRole("heading", { name: "麺の硬さは？" }).waitFor({ timeout: 20000 });
await p.waitForTimeout(1200);
const cdp = await c.newCDPSession(p);
const frames = [];
let capturing = true;
const loop = (async () => {
  while (capturing) {
    // 切り出す位置はページの座標なので、いま見えている位置（下へ送った分）に合わせる。
    const { cssVisualViewport: vv } = await cdp.send("Page.getLayoutMetrics");
    const r = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 88, optimizeForSpeed: true, clip: { x: vv.pageX, y: vv.pageY, width: 405, height: 720, scale: 2 } });
    const t = Date.now() / 1000;
    const file = `${OUT}/frames/${String(frames.length).padStart(5, "0")}.jpg`;
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    frames.push({ file, t });
  }
})();
await p.waitForTimeout(400);
const T0 = Date.now() / 1000;
const events = [];
const until = async (s) => { const ms = (T0 + s) * 1000 - Date.now(); if (ms > 0) await p.waitForTimeout(ms); };
const plan = [[1.2, "硬め"], [2.0, "濃いめ"], [2.8, "多め"], [3.6, "1 杯たのむ"], [4.4, "少し入れる"], [5.2, "飲み干す"]];
for (const [s, label] of plan) {
  await until(s);
  const btn = p.getByRole("button", { name: label, exact: true });
  const box = await btn.boundingBox();
  await p.mouse.move(box.x + box.width * 0.35, box.y + box.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(90);
  await p.mouse.up();
  events.push({ kind: "answer", t: Date.now() / 1000 - T0 });
}
events.push({ kind: "result", t: Date.now() / 1000 - T0 });
// 金色の取り出し口 → カード → 判子 → 虹色の光を見せてから、あるあるまで下へ送る。
await until(9.4);
await p.evaluate(() => {
  const target = [...document.querySelectorAll("h3")].find((h) => h.textContent?.includes("あるある"));
  const y = (target?.getBoundingClientRect().top ?? 600) + window.scrollY - 90;
  window.scrollTo({ top: y, behavior: "smooth" });
});
events.push({ kind: "scroll", t: Date.now() / 1000 - T0 });
await until(13.2);
capturing = false;
await loop;
fs.writeFileSync(`${OUT}/timeline.json`, JSON.stringify({ T0, frames: frames.map((f) => ({ ...f, t: f.t - T0 })), events }, null, 1));
console.log(events.map((e) => `${e.kind} ${e.t.toFixed(2)}`).join("\n"), "\nframes", frames.length);
await b.close();
