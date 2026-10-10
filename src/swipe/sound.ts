import type { SwipeDir } from "../lib/swipe";

/*
 * 家系スワイプの音（#166、オーナーと決めた）。
 *
 * - 払う音: 録音の「シュッ」（public/sounds/swoop.mp3、CC0。出典は public/sounds/CREDITS.txt）。
 *   何十回聞いても気にならない小ささ。行きたいとパスの差は長さだけ
 * - 主張のある音は 3 つの場面だけ: 発券（今日はここ）の「ゴトッ」・レア札の低い和音・FEVER の始まり。
 *   合成の音は 1.4kHz のローパスに通し、耳に刺さる高い成分を出さない。立ち上がりは数十 ms で柔らかく
 * - 音は最初の操作から鳴らす（ブラウザは操作の前の音を止める）。消音はこの端末に残す
 */

const MUTE_KEY = "iekei-swipe-muted";
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
})();
let ctx: AudioContext | null = null;
let synth: AudioNode | null = null;
let master: GainNode | null = null;
let swoop: Promise<AudioBuffer | null> | null = null;

export const isMuted = () => muted;
export function setMuted(next: boolean) {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {
    // 残せなくても、この画面の間は効く。
  }
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1400;
      lp.Q.value = 0.5;
      master = ctx.createGain();
      master.gain.value = 0.45;
      lp.connect(master).connect(ctx.destination);
      synth = lp;
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  type: OscillatorType,
  f0: number,
  f1: number,
  t: number,
  dur: number,
  vol: number,
  attack = 0.025,
) {
  const a = audio();
  if (!a || !synth) return;
  const o = a.createOscillator();
  const g = a.createGain();
  const at = a.currentTime + t;
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(f1, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(synth);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** 広い帯域のノイズ（xorshift。種を固定して毎回同じ波形）。周期のある波形だと音程が立つ。 */
function noise(dur: number, freq: number, vol: number) {
  const a = audio();
  if (!a || !synth) return;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const ch = buf.getChannelData(0);
  let x = 0x2545f491;
  for (let i = 0; i < ch.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    ch[i] = (((x >>> 0) / 4294967295) * 2 - 1) * (1 - i / ch.length);
  }
  const src = a.createBufferSource();
  const f = a.createBiquadFilter();
  const g = a.createGain();
  src.buffer = buf;
  f.type = "lowpass";
  f.frequency.value = freq;
  g.gain.value = vol;
  src.connect(f).connect(g).connect(synth);
  src.start();
}

function loadSwoop(a: AudioContext): Promise<AudioBuffer | null> {
  swoop ??= fetch("/sounds/swoop.mp3")
    .then((res) => {
      if (!res.ok) throw new Error(`払う音を読み込めませんでした（${res.status}）`);
      return res.arrayBuffer();
    })
    .then((data) => a.decodeAudioData(data))
    .catch(() => null);
  return swoop;
}

/** 音を出す準備（最初の操作で呼ぶ）。払う音の読み込みも始める。 */
export function unlock() {
  const a = audio();
  if (a) void loadSwoop(a);
}

export const sound = {
  async swipe(dir: SwipeDir) {
    const a = audio();
    if (!a || !master) return;
    const buf = await loadSwoop(a);
    if (!buf) return;
    const src = a.createBufferSource();
    const g = a.createGain();
    const at = a.currentTime;
    src.buffer = buf;
    g.gain.value = 0.55;
    // パスは少し早めに抜く（差は長さだけ）。録音は 1.4kHz のローパスを通さない（「シュッ」らしさが消える）。
    if (dir === "pass") {
      g.gain.setValueAtTime(0.55, at + buf.duration * 0.7);
      g.gain.linearRampToValueAtTime(0.0001, at + buf.duration * 0.85);
    }
    src.connect(g).connect(master);
    src.start(at);
  },
  issue() {
    tone("sine", 120, 55, 0, 0.22, 0.5, 0.02);
    noise(0.14, 420, 0.25);
  },
  rare() {
    for (const [i, f] of [196, 247, 294, 392].entries())
      tone("triangle", f, f, i * 0.07, 0.9, 0.18, 0.04);
    tone("sine", 98, 70, 0, 0.8, 0.35, 0.04);
  },
  fever() {
    tone("sawtooth", 110, 220, 0, 0.9, 0.12, 0.08);
    tone("triangle", 330, 330, 0.3, 0.8, 0.12, 0.06);
  },
};
