/*
 * 家系カメラ（#190）の写真の加工。**すべて端末の中**（canvas）で行い、サーバーに送らない。
 * canvas から書き出すと、元の写真の EXIF（位置情報を含む）は付いてこない。向きは読み込むときに反映する。
 * 色の加工は画素を直接いじる（Safari の古い版は canvas の filter に対応していないため）。
 *
 * 加工は重いので、写真か加工を変えたときだけ作る（applyEffect）。判子とフレームは frames.ts が毎回重ねる。
 */

export type EffectKey = "none" | "yuge" | "yoru" | "film" | "manga" | "shuchu" | "dot";

interface Tone {
  /** 赤を足して青を引く量（暖かさ）。 */
  warmth: number;
  contrast: number;
  brightness: number;
  saturation: number;
  /** 黒を持ち上げる量（色あせ）。 */
  fade: number;
  /** 周辺を暗くする強さ（0〜1）。 */
  vignette: number;
  /** 粒子の強さ。 */
  grain: number;
  /** 上から白い霞をかける強さ（湯気）。 */
  haze: number;
}

const PLAIN: Tone = {
  warmth: 0,
  contrast: 1,
  brightness: 0,
  saturation: 1,
  fade: 0,
  vignette: 0,
  grain: 0,
  haze: 0,
};

const TONES: Partial<Record<EffectKey, Tone>> = {
  yuge: {
    ...PLAIN,
    warmth: 16,
    contrast: 0.94,
    brightness: 10,
    saturation: 1.05,
    fade: 14,
    vignette: 0.25,
    haze: 0.22,
  },
  yoru: { ...PLAIN, warmth: 12, contrast: 1.22, brightness: -14, saturation: 1.12, vignette: 0.6 },
  film: {
    ...PLAIN,
    warmth: 8,
    contrast: 0.92,
    brightness: 4,
    saturation: 0.82,
    fade: 26,
    vignette: 0.32,
    grain: 14,
  },
};

export const EFFECTS: { key: EffectKey; label: string }[] = [
  { key: "none", label: "そのまま" },
  { key: "manga", label: "漫画" },
  { key: "shuchu", label: "集中線" },
  { key: "dot", label: "ドット絵" },
  { key: "yuge", label: "湯気" },
  { key: "yoru", label: "夜の一杯" },
  { key: "film", label: "フィルム" },
];

/** 長い辺の上限。SNS に上げるには十分で、加工が速い。 */
const MAX_EDGE = 1600;

/** 写真を読み込む（端末の向きの情報は、ここで画素に反映される）。 */
export const loadPhoto = (file: Blob) =>
  createImageBitmap(file, { imageOrientation: "from-image" });

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** 種を固定した乱数（毎回同じ絵になる）。 */
function random(seed = 0x2545f491) {
  let x = seed;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967295;
  };
}

function canvasOf(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext("2d", { willReadFrequently: true })! };
}

/** 画素ごとの色の加工（湯気・夜の一杯・フィルム）。 */
function tone(ctx: CanvasRenderingContext2D, w: number, h: number, p: Tone) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const rnd = random();
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    r = luma + (r - luma) * p.saturation;
    g = luma + (g - luma) * p.saturation;
    b = luma + (b - luma) * p.saturation;
    r = (r - 128) * p.contrast + 128 + p.brightness + p.warmth;
    g = (g - 128) * p.contrast + 128 + p.brightness + p.warmth * 0.3;
    b = (b - 128) * p.contrast + 128 + p.brightness - p.warmth;
    if (p.fade) {
      r = p.fade + r * (1 - p.fade / 255);
      g = p.fade + g * (1 - p.fade / 255);
      b = p.fade + b * (1 - p.fade / 255);
    }
    if (p.grain) {
      const n = (rnd() - 0.5) * p.grain * 2;
      r += n;
      g += n;
      b += n;
    }
    d[i] = clamp(r);
    d[i + 1] = clamp(g);
    d[i + 2] = clamp(b);
  }
  ctx.putImageData(img, 0, 0);
  if (p.haze) {
    const haze = ctx.createLinearGradient(0, 0, 0, h * 0.6);
    haze.addColorStop(0, `rgba(255,250,240,${p.haze})`);
    haze.addColorStop(1, "rgba(255,250,240,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, w, h);
  }
  if (p.vignette) vignette(ctx, w, h, p.vignette);
}

function vignette(ctx: CanvasRenderingContext2D, w: number, h: number, strength: number) {
  const v = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.35,
    w / 2,
    h / 2,
    Math.hypot(w, h) / 2,
  );
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

/** 漫画: 白黒にして、暗い所はベタ、中間は網点、明るい所は白に飛ばす。 */
function manga(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const src = ctx.getImageData(0, 0, w, h).data;
  const lumaAt = (x: number, y: number) => {
    const i = (Math.min(h - 1, y) * w + Math.min(w - 1, x)) * 4;
    return 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
  };
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#111";
  const cell = Math.max(5, Math.round(Math.min(w, h) / 110));
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      // コントラストを強めてから、濃さで網点の大きさを決める。
      const l = clamp((lumaAt(x + (cell >> 1), y + (cell >> 1)) - 128) * 1.2 + 150);
      if (l < 40) {
        ctx.fillRect(x, y, cell, cell);
      } else if (l < 228) {
        const r = (cell / 2) * Math.sqrt(1 - l / 255) * 1.35;
        ctx.beginPath();
        ctx.arc(x + cell / 2, y + cell / 2, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** 集中線: 周りから真ん中へ向かう効果線と、「ドーン」の書き文字。 */
function shuchu(ctx: CanvasRenderingContext2D, w: number, h: number) {
  tone(ctx, w, h, { ...PLAIN, contrast: 1.15, saturation: 1.15 });
  const rnd = random(0x1234567);
  const cx = w / 2;
  const cy = h / 2;
  const outer = Math.hypot(w, h);
  const inner = Math.min(w, h) * 0.33;
  ctx.fillStyle = "rgba(15,10,8,0.85)";
  for (let i = 0; i < 150; i++) {
    const a = rnd() * Math.PI * 2;
    const spread = 0.004 + rnd() * 0.012;
    const start = inner * (1 + rnd() * 0.5);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * start, cy + Math.sin(a) * start);
    ctx.lineTo(cx + Math.cos(a - spread) * outer, cy + Math.sin(a - spread) * outer);
    ctx.lineTo(cx + Math.cos(a + spread) * outer, cy + Math.sin(a + spread) * outer);
    ctx.closePath();
    ctx.fill();
  }
  const size = Math.round(Math.min(w, h) * 0.17);
  ctx.save();
  ctx.translate(w * 0.08, h * 0.08 + size);
  ctx.rotate(-0.18);
  ctx.font = `900 ${size}px "Hiragino Sans", "Noto Sans JP", sans-serif`;
  ctx.lineJoin = "round";
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = "#fff";
  ctx.strokeText("ドーン", 0, 0);
  ctx.fillStyle = "#c0392b";
  ctx.fillText("ドーン", 0, 0);
  ctx.restore();
}

/** ドット絵: 粗く縮めて色の段を減らし、角ばったまま引き伸ばす。 */
function dot(c: HTMLCanvasElement, ctx: CanvasRenderingContext2D, w: number, h: number) {
  const across = 72;
  const sw = across;
  const sh = Math.max(1, Math.round((h / w) * across));
  const small = canvasOf(sw, sh);
  small.ctx.drawImage(c, 0, 0, sw, sh);
  const img = small.ctx.getImageData(0, 0, sw, sh);
  const step = 255 / 4;
  for (let i = 0; i < img.data.length; i += 4)
    for (let k = 0; k < 3; k++) img.data[i + k] = Math.round(img.data[i + k] / step) * step;
  small.ctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small.c, 0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
}

/** 写真に加工をかけた絵を作る（判子とフレームの下地）。 */
export function applyEffect(photo: ImageBitmap, effect: EffectKey): HTMLCanvasElement {
  const scale = Math.min(1, MAX_EDGE / Math.max(photo.width, photo.height));
  const w = Math.round(photo.width * scale);
  const h = Math.round(photo.height * scale);
  const { c, ctx } = canvasOf(w, h);
  ctx.drawImage(photo, 0, 0, w, h);
  const t = TONES[effect];
  if (t) tone(ctx, w, h, t);
  else if (effect === "manga") manga(ctx, w, h);
  else if (effect === "shuchu") shuchu(ctx, w, h);
  else if (effect === "dot") dot(c, ctx, w, h);
  return c;
}

/** 書き出す（JPEG）。canvas からの書き出しには、元の写真の EXIF（位置情報）は付かない。 */
export const exportPhoto = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("写真を書き出せませんでした。"))),
      "image/jpeg",
      0.9,
    ),
  );
