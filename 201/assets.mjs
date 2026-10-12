// 家系タイプ診断の紹介動画（#201）の文字の帯・締めの画面・音（払う音・発券・激レアの和音だけ。BGM なし）。
//   node assets.mjs <作業フォルダ> <favicon.svg のパス>
import { chromium } from "playwright";
import fs from "node:fs";
const [V, ICON] = process.argv.slice(2);
const tl = JSON.parse(fs.readFileSync(`${V}/timeline.json`, "utf8"));
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
const font = `'Hiragino Sans', 'Hiragino Kaku Gothic ProN', sans-serif`;
const captions = {
  a: "家系の注文で、<br>あなたのタイプが分かる",
  b: "1 問 1 タップ、6 問だけ",
  c: `<span style="color:#f2c14e">27 通りに 1 つの「激レア」</span>`,
  d: "このあるある、分かる？",
};
for (const [k, text] of Object.entries(captions)) {
  await p.setContent(`<html><body style="margin:0;background:transparent;width:1080px;height:1920px;position:relative">
  <div style="position:absolute;left:0;right:0;bottom:0;height:360px;background:rgba(33,24,20,0.93);display:flex;align-items:center;justify-content:center;text-align:center">
  <div style="color:#fff;font-family:${font};font-weight:800;font-size:66px;line-height:1.35;letter-spacing:1px;padding:0 56px">${text}</div></div></body></html>`);
  await p.screenshot({ path: `${V}/cap-${k}.png`, omitBackground: true });
}
const bowl = fs.readFileSync(ICON, "utf8");
await p.setContent(`<html><body style="margin:0;width:1080px;height:1920px;background:#f7f4ef;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:52px;font-family:${font};color:#211814">
  <div style="width:260px;height:260px">${bowl.replace(/<svg([^>]*)width="[^"]*"([^>]*)height="[^"]*"/, '<svg$1width="260"$2height="260"')}</div>
  <div style="font-weight:800;font-size:132px;letter-spacing:4px">家系タイプ診断</div>
  <div style="font-weight:700;font-size:58px;color:#5c514a">6 問で、あなたの家系の注文が分かる</div>
  <div style="margin-top:40px;padding:28px 64px;border-radius:999px;background:#b8442c;color:#fff;font-weight:800;font-size:68px">リンクは返信に</div>
</body></html>`);
await p.screenshot({ path: `${V}/close.png` });

// 音（アプリと同じ鳴らし方）。答えるたびに払う音を小さく（0.25）、結果で激レアの和音、0.65 秒後に発券の「ゴトッ」。
const answers = tl.events.filter((e) => e.kind === "answer").map((e) => e.t);
const result = tl.events.find((e) => e.kind === "result").t;
const mp3 = fs.readFileSync(`${V}/swoop.mp3`).toString("base64");
const wav = await p.evaluate(async ({ mp3, answers, result }) => {
  const rate = 48000;
  const ctx = new OfflineAudioContext(2, rate * 15, rate);
  const buf = await ctx.decodeAudioData(Uint8Array.from(atob(mp3), (c) => c.charCodeAt(0)).buffer);
  const master = ctx.createGain();
  master.gain.value = 0.45 * 1.6;
  master.connect(ctx.destination);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1400;
  lp.Q.value = 0.5;
  lp.connect(master);
  for (const t of answers) {
    const s = ctx.createBufferSource();
    const g = ctx.createGain();
    s.buffer = buf;
    g.gain.value = 0.25;
    s.connect(g).connect(master);
    s.start(t);
  }
  const tone = (type, f0, f1, t, dur, vol, attack) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(lp);
    o.start(t);
    o.stop(t + dur + 0.05);
  };
  // 激レアの和音（sound.rare）
  for (const [i, f] of [196, 247, 294, 392].entries()) tone("triangle", f, f, result + i * 0.07, 0.9, 0.18, 0.04);
  tone("sine", 98, 70, result, 0.8, 0.35, 0.04);
  // 発券の「ゴトッ」（sound.issue）。激レアはカードが 0.65 秒遅れて出る。
  const at = result + 0.65;
  tone("sine", 120, 55, at, 0.22, 0.5, 0.02);
  const nb = ctx.createBuffer(1, Math.floor(rate * 0.14), rate);
  const ch = nb.getChannelData(0);
  let x = 0x2545f491;
  for (let i = 0; i < ch.length; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    ch[i] = (((x >>> 0) / 4294967295) * 2 - 1) * (1 - i / ch.length);
  }
  const ns = ctx.createBufferSource();
  const nf = ctx.createBiquadFilter();
  const ng = ctx.createGain();
  ns.buffer = nb;
  nf.type = "lowpass";
  nf.frequency.value = 420;
  ng.gain.value = 0.25;
  ns.connect(nf).connect(ng).connect(lp);
  ns.start(at);
  const out = await ctx.startRendering();
  const n = out.length;
  const chs = [out.getChannelData(0), out.getChannelData(1)];
  const dv = new DataView(new ArrayBuffer(44 + n * 4));
  const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); dv.setUint32(4, 36 + n * 4, true); w(8, "WAVEfmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) dv.setInt16(44 + (i * 2 + c) * 2, Math.max(-1, Math.min(1, chs[c][i])) * 0x7fff, true);
  let s = "";
  const u = new Uint8Array(dv.buffer);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}, { mp3, answers, result });
fs.writeFileSync(`${V}/audio.wav`, Buffer.from(wav, "base64"));
console.log("answers", answers.length, "result", result);
await b.close();
