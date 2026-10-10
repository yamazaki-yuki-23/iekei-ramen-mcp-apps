// 文字の帯（透過 PNG）と締めの画面、音（払う音と FEVER の音だけ）を作る。
import { chromium } from "playwright";
import fs from "node:fs";
const V = process.argv[2];
const tl = JSON.parse(fs.readFileSync(`${V}/timeline.json`, "utf8"));
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
const font = `'Hiragino Sans', 'Hiragino Kaku Gothic ProN', sans-serif`;
const captions = {
  a: "家系ラーメンと、マッチング。",
  b: "右で行きたい、左でパス",
  c: "めくるまで、<br>どんな店か分からない",
  d: `<span style="color:#f2c14e;font-size:120px;letter-spacing:4px">FEVER！</span>`,
};
for (const [k, text] of Object.entries(captions)) {
  await p.setContent(`<html><body style="margin:0;background:transparent;width:1080px;height:1920px;position:relative">
  <div style="position:absolute;left:0;right:0;bottom:0;height:360px;background:rgba(33,24,20,0.93);display:flex;align-items:center;justify-content:center;text-align:center">
  <div style="color:#fff;font-family:${font};font-weight:800;font-size:66px;line-height:1.35;letter-spacing:1px;padding:0 56px">${text}</div></div></body></html>`);
  await p.screenshot({ path: `${V}/cap-${k}.png`, omitBackground: true });
}
const bowl = fs.readFileSync(`${V}/bowl.svg`, "utf8");
await p.setContent(`<html><body style="margin:0;width:1080px;height:1920px;background:#f7f4ef;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:56px;font-family:${font};color:#211814">
  <div style="width:260px;height:260px">${bowl.replace("<svg", '<svg width="260" height="260"')}</div>
  <div style="font-weight:800;font-size:150px;letter-spacing:4px">家系マッチ</div>
  <div style="font-weight:700;font-size:60px;color:#5c514a">近くの家系と、マッチング。</div>
  <div style="margin-top:40px;padding:28px 64px;border-radius:999px;background:#b8442c;color:#fff;font-weight:800;font-size:68px">リンクは返信に</div>
</body></html>`);
await p.screenshot({ path: `${V}/close.png` });

// 音: 払う音はアプリと同じ鳴らし方（0.55×0.45、パスは早めに抜く）。FEVER は 1.4kHz ローパスを通した合成音。
const swipes = tl.events.filter((e) => e.kind === "swipe" && e.t < 13).map((e) => [e.t, e.dir]);
const fever = tl.events.find((e) => e.kind === "fever")?.t;
const mp3 = fs.readFileSync(`${V}/swoop.mp3`).toString("base64");
const wav = await p.evaluate(async ({ mp3, swipes, fever }) => {
  const rate = 48000, len = 15;
  const ctx = new OfflineAudioContext(2, rate * len, rate);
  const raw = Uint8Array.from(atob(mp3), (c) => c.charCodeAt(0)).buffer;
  const buf = await ctx.decodeAudioData(raw);
  const master = ctx.createGain(); master.gain.value = 0.45 * 1.6; master.connect(ctx.destination);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1400; lp.Q.value = 0.5; lp.connect(master);
  for (const [t, dir] of swipes) {
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = buf; g.gain.setValueAtTime(0.55, t);
    if (dir === "pass") { g.gain.setValueAtTime(0.55, t + buf.duration * 0.7); g.gain.linearRampToValueAtTime(0.0001, t + buf.duration * 0.85); }
    s.connect(g).connect(master); s.start(t);
  }
  const tone = (type, f0, f1, t, dur, vol, attack) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(lp); o.start(t); o.stop(t + dur + 0.05);
  };
  if (fever !== undefined) { tone("sawtooth", 110, 220, fever, 0.9, 0.12, 0.08); tone("triangle", 330, 330, fever + 0.3, 0.8, 0.12, 0.06); }
  const out = await ctx.startRendering();
  const n = out.length, chs = [out.getChannelData(0), out.getChannelData(1)];
  const dv = new DataView(new ArrayBuffer(44 + n * 4));
  const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); dv.setUint32(4, 36 + n * 4, true); w(8, "WAVEfmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) dv.setInt16(44 + (i * 2 + c) * 2, Math.max(-1, Math.min(1, chs[c][i])) * 0x7fff, true);
  let s = ""; const u = new Uint8Array(dv.buffer);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}, { mp3, swipes, fever });
fs.writeFileSync(`${V}/audio.wav`, Buffer.from(wav, "base64"));
console.log("swipes", swipes.length, "fever", fever);
await b.close();
