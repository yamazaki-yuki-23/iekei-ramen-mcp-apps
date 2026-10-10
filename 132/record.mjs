// 家系マッチの紹介動画（#132）の素材を本番から撮る。映像は CDP の画面キャプチャ、時刻は壁時計で記録する。
import { chromium } from "playwright";
import fs from "node:fs";
const OUT = process.argv[2];
fs.mkdirSync(`${OUT}/frames`, { recursive: true });
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 405, height: 720 }, deviceScaleFactor: 1080 / 405 });
await c.addInitScript(() => {
  const Z = 0.8;
  document.addEventListener("DOMContentLoaded", () => {
    document.documentElement.style.zoom = String(Z);
    const dot = document.createElement("div");
    Object.assign(dot.style, { position: "fixed", left: "0", top: "0", width: "56px", height: "56px", margin: "-28px 0 0 -28px", borderRadius: "50%", background: "rgba(255,255,255,0.55)", border: "4px solid rgba(40,30,25,0.75)", boxShadow: "0 2px 10px rgba(0,0,0,0.3)", pointerEvents: "none", zIndex: "99999", opacity: "0", transition: "opacity 120ms, transform 120ms", transform: "scale(0.6)" });
    document.body.appendChild(dot);
    const z = Z;
    const at = (e) => { dot.style.left = `${e.clientX / z}px`; dot.style.top = `${e.clientY / z}px`; };
    addEventListener("pointerdown", (e) => { at(e); dot.style.opacity = "1"; dot.style.transform = "scale(1)"; }, true);
    addEventListener("pointermove", (e) => at(e), true);
    addEventListener("pointerup", () => { dot.style.opacity = "0"; dot.style.transform = "scale(0.6)"; }, true);
  });
});
await c.route("**/mcp", async (route) => {
  const req = route.request();
  let body = req.postData();
  if (req.method() === "POST" && body && body.includes("find-nearby-iekei-ramen")) {
    const j = JSON.parse(body);
    if (j.params?.arguments && j.params.arguments.lat === undefined)
      Object.assign(j.params.arguments, { lat: 35.4658, lon: 139.6222, label: "横浜駅付近", source: "precise" });
    body = JSON.stringify(j);
  }
  await route.continue({ postData: body });
});
const p = await c.newPage();
await p.goto("https://iekeiramen.com/match/");
const top = p.locator("article[data-shop-id]:not([aria-hidden])");
await top.waitFor({ timeout: 20000 });
await p.waitForTimeout(1500);

const cdp = await c.newCDPSession(p);
const frames = [];
let capturing = true;
const loop = (async () => {
  while (capturing) {
    const r = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 88, optimizeForSpeed: true, clip: { x: 0, y: 0, width: 405, height: 720, scale: 2 } });
    const t = Date.now() / 1000;
    const file = `${OUT}/frames/${String(frames.length).padStart(5, "0")}.jpg`;
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    frames.push({ file, t });
  }
})();
await p.waitForTimeout(500);

const T0 = Date.now() / 1000;
await p.exposeFunction("__feverAt", (t) => events.push({ kind: "fever", t: t / 1000 - T0 }));
await p.evaluate(() => {
  const mo = new MutationObserver(() => {
    if (document.querySelector("[class*=feverOn]")) { mo.disconnect(); window.__feverAt(Date.now()); }
  });
  mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
});
const events = [];
const until = async (s) => { const ms = (T0 + s) * 1000 - Date.now(); if (ms > 0) await p.waitForTimeout(ms); };
async function swipe(dir, name) {
  const box = await top.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height * 0.55;
  const dx = (dir === "want" ? 1 : -1) * box.width * 0.75;
  await p.mouse.move(x, y);
  await p.mouse.down();
  for (let i = 1; i <= 10; i++) { await p.mouse.move(x + (dx * i) / 10, y - 6 * i / 10); await p.waitForTimeout(22); }
  await p.mouse.up();
  events.push({ kind: "swipe", dir, name, t: Date.now() / 1000 - T0 + 0.22 });
}
const plan = [[0.3, "want"], [2.3, "want"], [3.9, "pass"], [7.6, "want"], [8.4, "want"], [9.05, "want"], [9.7, "want"], [10.6, "want"], [11.4, "want"], [12.2, "want"]];
for (const [s, dir] of plan) {
  await until(s);
  const name = await top.getAttribute("aria-label");
  await swipe(dir, name);

}
await until(13.4);
capturing = false;
await loop;
await p.waitForTimeout(300);
fs.writeFileSync(`${OUT}/timeline.json`, JSON.stringify({ T0, frames: frames.map((f) => ({ ...f, t: f.t - T0 })), events }, null, 1));
console.log(events.map((e) => `${e.kind} ${e.dir ?? ""} ${e.t.toFixed(2)} ${e.name ?? ""}`).join("\n"));
console.log("frames", frames.length);
await b.close();
