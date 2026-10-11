/*
 * 家系カメラ（仮、#190）のフレームと判子。加工した写真（photo.ts の applyEffect）の上に毎回重ねる。
 * **すべて端末の中（canvas）。** 入れる文字は店名・地域・日付・利用者が選んだひとことだけで、
 * 店の評価（人気・おいしい・おすすめ）は入れない（frameTexts をテストで見張る）。
 */

export type FrameKey = "none" | "ticket" | "kanban" | "gougai" | "receipt" | "polaroid";

export const FRAMES: { key: FrameKey; label: string }[] = [
  { key: "none", label: "なし" },
  { key: "ticket", label: "食券" },
  { key: "kanban", label: "看板" },
  { key: "gougai", label: "号外" },
  { key: "receipt", label: "レシート" },
  { key: "polaroid", label: "ポラロイド" },
];

export interface Meta {
  name: string;
  area: string;
  date: Date;
}

export interface Stamp {
  text: string;
  /** 写真の中の真ん中の位置（0〜1）。 */
  x: number;
  y: number;
  /** 写真の短い辺に対する文字の大きさ（0〜1）。 */
  size: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const INK = "#211814";
const RED = "#c0392b";
const GOTHIC = `"Hiragino Sans", "Noto Sans JP", sans-serif`;
const MONO = `"Osaka-Mono", "Menlo", "Noto Sans Mono CJK JP", monospace`;

const pad2 = (n: number) => String(n).padStart(2, "0");
export const day = (d: Date) => `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
const stampTime = (d: Date) =>
  `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** フレームに入れる文字（テストで、評価の言葉が無いことを確かめる）。 */
export function frameTexts(frame: FrameKey, m: Meta): string[] {
  switch (frame) {
    case "ticket":
      return ["食券", m.name, m.area, day(m.date)];
    case "kanban":
      return [m.name, `${m.area}　${day(m.date)}`];
    case "gougai":
      return ["号外", "本日の一杯", `${m.name}（${m.area}）`, day(m.date)];
    case "receipt":
      return [m.name, m.area, stampTime(m.date), "ラーメン", "1 杯"];
    case "polaroid":
      return [m.name, `${m.area}・${day(m.date)}`];
    default:
      return [];
  }
}

/** 幅に収まるまで文字を小さくする。 */
function fit(
  ctx: CanvasRenderingContext2D,
  value: string,
  max: number,
  size: number,
  weight: number,
  family = GOTHIC,
) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(value).width > max && s > 8) {
    s *= 0.92;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  opts: {
    size: number;
    weight?: number;
    color?: string;
    align?: CanvasTextAlign;
    max?: number;
    family?: string;
  },
) {
  const weight = opts.weight ?? 700;
  const size = opts.max ? fit(ctx, value, opts.max, opts.size, weight, opts.family) : opts.size;
  ctx.font = `${weight} ${size}px ${opts.family ?? GOTHIC}`;
  ctx.fillStyle = opts.color ?? INK;
  ctx.textAlign = opts.align ?? "left";
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}

/** フレームの大きさと、写真を置く場所。 */
function layout(frame: FrameKey, w: number, h: number) {
  const b = Math.min(w, h);
  switch (frame) {
    case "ticket": {
      const m = b * 0.06;
      const head = b * 0.18;
      const foot = b * 0.15;
      return { W: w + m * 2, H: h + m * 2 + head + foot, img: { x: m, y: m + head, w, h } };
    }
    case "kanban": {
      const band = b * 0.28;
      const foot = b * 0.1;
      return { W: w, H: h + band + foot, img: { x: 0, y: band, w, h } };
    }
    case "gougai": {
      const m = b * 0.05;
      const head = b * 0.36;
      return { W: w + m * 2, H: h + m * 2 + head, img: { x: m, y: m + head, w, h } };
    }
    case "receipt": {
      const m = b * 0.08;
      const head = b * 0.34;
      const foot = b * 0.26;
      return { W: w + m * 2, H: h + head + foot, img: { x: m, y: head, w, h } };
    }
    case "polaroid": {
      const m = b * 0.06;
      const foot = b * 0.28;
      return { W: w + m * 2, H: h + m + foot, img: { x: m, y: m, w, h } };
    }
    default:
      return { W: w, H: h, img: { x: 0, y: 0, w, h } };
  }
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  frame: FrameKey,
  W: number,
  H: number,
  img: Rect,
  m: Meta,
) {
  const b = Math.min(img.w, img.h);
  const [t0, t1, t2, t3, t4] = frameTexts(frame, m);
  switch (frame) {
    case "ticket": {
      // 食券: 生成りの紙に黒い縁。上に「食券」の札と店名、下にミシン目と地域・日付。
      ctx.fillStyle = "#fbf3e1";
      ctx.fillRect(0, 0, W, H);
      const lw = b * 0.014;
      ctx.lineWidth = lw;
      ctx.strokeStyle = INK;
      ctx.strokeRect(lw / 2, lw / 2, W - lw, H - lw);
      const headMid = img.y / 2 + lw;
      const tag = b * 0.2;
      ctx.fillStyle = RED;
      ctx.fillRect(img.x, headMid - b * 0.06, tag, b * 0.12);
      text(ctx, t0, img.x + tag / 2, headMid, {
        size: b * 0.075,
        weight: 900,
        color: "#fff",
        align: "center",
      });
      text(ctx, t1, img.x + tag + b * 0.04, headMid, {
        size: b * 0.09,
        weight: 900,
        max: img.w - tag - b * 0.06,
      });
      const perf = img.y + img.h + b * 0.03;
      ctx.setLineDash([b * 0.025, b * 0.018]);
      ctx.lineWidth = b * 0.008;
      ctx.beginPath();
      ctx.moveTo(lw, perf);
      ctx.lineTo(W - lw, perf);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#e7dcc6";
      for (const x of [0, W]) {
        ctx.beginPath();
        ctx.arc(x, perf, b * 0.04, 0, Math.PI * 2);
        ctx.fill();
      }
      const footMid = (perf + H) / 2;
      text(ctx, t2, img.x, footMid, { size: b * 0.06, max: img.w * 0.55 });
      text(ctx, t3, img.x + img.w, footMid, { size: b * 0.06, align: "right" });
      break;
    }
    case "kanban": {
      // 黄色い看板: 太い黒文字の店名、下に赤い帯。
      ctx.fillStyle = "#f5c400";
      ctx.fillRect(0, 0, W, img.y);
      ctx.fillStyle = RED;
      ctx.fillRect(0, img.y - b * 0.035, W, b * 0.035);
      text(ctx, t0, W / 2, (img.y - b * 0.035) / 2, {
        size: b * 0.16,
        weight: 900,
        align: "center",
        max: W * 0.9,
      });
      ctx.fillStyle = "#f5c400";
      ctx.fillRect(0, img.y + img.h, W, H - img.y - img.h);
      text(ctx, t1, W / 2, (img.y + img.h + H) / 2, {
        size: b * 0.05,
        align: "center",
        max: W * 0.9,
      });
      break;
    }
    case "gougai": {
      // 号外: 新聞の紙に、赤い「号外」と大きな見出し。
      ctx.fillStyle = "#f1ece0";
      ctx.fillRect(0, 0, W, H);
      const top = img.x;
      const box = b * 0.2;
      ctx.fillStyle = RED;
      ctx.fillRect(W - top - box, top, box, box);
      text(ctx, t0, W - top - box / 2, top + box / 2, {
        size: b * 0.085,
        weight: 900,
        color: "#fff",
        align: "center",
      });
      text(ctx, t1, top, top + box * 0.5, { size: b * 0.14, weight: 900, max: W - top * 3 - box });
      ctx.fillStyle = INK;
      const rule = top + box + b * 0.03;
      ctx.fillRect(top, rule, W - top * 2, b * 0.01);
      ctx.fillRect(top, rule + b * 0.018, W - top * 2, b * 0.004);
      const sub = (rule + img.y) / 2 + b * 0.01;
      text(ctx, t2, top, sub, { size: b * 0.06, max: (W - top * 2) * 0.7 });
      text(ctx, t3, W - top, sub, { size: b * 0.045, align: "right" });
      ctx.lineWidth = b * 0.008;
      ctx.strokeStyle = INK;
      ctx.strokeRect(img.x, img.y, img.w, img.h);
      break;
    }
    case "receipt": {
      // レシート: 白い紙に等幅の文字、下はぎざぎざ。
      ctx.fillStyle = "#d9d6cf";
      ctx.fillRect(0, 0, W, H);
      const tooth = b * 0.03;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(W, 0);
      ctx.lineTo(W, H - tooth);
      for (let x = W; x > 0; x -= tooth * 2) {
        ctx.lineTo(x - tooth, H);
        ctx.lineTo(x - tooth * 2, H - tooth);
      }
      ctx.closePath();
      ctx.fill();
      const cx = W / 2;
      text(ctx, t0, cx, b * 0.08, {
        size: b * 0.07,
        weight: 700,
        align: "center",
        max: img.w,
        family: MONO,
      });
      text(ctx, t1, cx, b * 0.16, {
        size: b * 0.045,
        align: "center",
        family: MONO,
        color: "#444",
      });
      text(ctx, t2, cx, b * 0.23, {
        size: b * 0.045,
        align: "center",
        family: MONO,
        color: "#444",
      });
      const dash = (y: number) => {
        ctx.setLineDash([b * 0.02, b * 0.012]);
        ctx.lineWidth = b * 0.005;
        ctx.strokeStyle = "#555";
        ctx.beginPath();
        ctx.moveTo(img.x, y);
        ctx.lineTo(img.x + img.w, y);
        ctx.stroke();
        ctx.setLineDash([]);
      };
      dash(b * 0.29);
      const after = img.y + img.h;
      dash(after + b * 0.05);
      text(ctx, t3, img.x, after + b * 0.12, { size: b * 0.055, family: MONO });
      text(ctx, t4, img.x + img.w, after + b * 0.12, {
        size: b * 0.055,
        align: "right",
        family: MONO,
      });
      break;
    }
    case "polaroid": {
      // ポラロイド: 白い縁と、下の余白に手書き風の店名と日付。
      ctx.fillStyle = "#fbfaf7";
      ctx.fillRect(0, 0, W, H);
      const below = img.y + img.h;
      text(ctx, t0, W / 2, below + (H - below) * 0.38, {
        size: b * 0.085,
        weight: 700,
        align: "center",
        max: img.w * 0.9,
      });
      text(ctx, t1, W / 2, below + (H - below) * 0.68, {
        size: b * 0.05,
        align: "center",
        color: "#5c514a",
        max: img.w * 0.9,
      });
      break;
    }
    default:
      break;
  }
}

const TILT = -0.17;
/** 判子の枠の線の太さ（文字の大きさに対する割合）。 */
const STROKE = 0.12;
const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 判子の大きさと真ん中を、傾けた外枠ごと写真に収まるように決める。
 * perEm は文字の幅（文字の大きさ 1 あたり）。大きすぎれば縮め、端に寄りすぎれば内側へ寄せる。
 */
export function placeStamp(img: Rect, s: Stamp, perEm: number) {
  const b = Math.min(img.w, img.h);
  const box = (size: number) => {
    const pw = perEm * size + size * 0.7;
    const ph = size * 1.5;
    // 枠の線は、太さの半分が外へはみ出して描かれる。収めるときは線の外側まで含める。
    const ow = pw + size * STROKE;
    const oh = ph + size * STROKE;
    const cos = Math.abs(Math.cos(TILT));
    const sin = Math.abs(Math.sin(TILT));
    return { pw, ph, hw: (cos * ow + sin * oh) / 2, hh: (sin * ow + cos * oh) / 2 };
  };
  let size = b * s.size;
  let outer = box(size);
  const room = Math.min((img.w * 0.96) / (outer.hw * 2), (img.h * 0.96) / (outer.hh * 2), 1);
  if (room < 1) {
    size *= room;
    outer = box(size);
  }
  return {
    size,
    pw: outer.pw,
    ph: outer.ph,
    cx: clampTo(img.x + img.w * s.x, img.x + outer.hw, img.x + img.w - outer.hw),
    cy: clampTo(img.y + img.h * s.y, img.y + outer.hh, img.y + img.h - outer.hh),
  };
}

/** ひとことの判子（赤い枠と文字、少し傾ける）。外枠ごと写真に収める。 */
function drawStamp(ctx: CanvasRenderingContext2D, img: Rect, s: Stamp) {
  ctx.font = `900 100px ${GOTHIC}`;
  const perEm = ctx.measureText(s.text).width / 100;
  const { size, pw, ph, cx, cy } = placeStamp(img, s, perEm);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(TILT);
  ctx.globalAlpha = 0.9;
  ctx.font = `900 ${size}px ${GOTHIC}`;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.strokeStyle = RED;
  ctx.lineWidth = size * STROKE;
  ctx.beginPath();
  ctx.roundRect(-pw / 2, -ph / 2, pw, ph, size * 0.18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = RED;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(s.text, 0, size * 0.04);
  ctx.restore();
}

/**
 * 加工した写真にフレーム・判子・右下の「iekeiramen.com」を重ねて、target に描く。
 * 返すのは target の中の写真の位置（指で判子を動かすときに使う）。
 */
export function compose(
  target: HTMLCanvasElement,
  base: HTMLCanvasElement,
  opts: { frame: FrameKey; stamp: Stamp | null; watermark: boolean; meta: Meta },
): Rect {
  const { W, H, img } = layout(opts.frame, base.width, base.height);
  target.width = Math.round(W);
  target.height = Math.round(H);
  const ctx = target.getContext("2d")!;
  drawFrame(ctx, opts.frame, W, H, img, opts.meta);
  ctx.drawImage(base, img.x, img.y, img.w, img.h);
  if (opts.stamp) drawStamp(ctx, img, opts.stamp);
  if (opts.watermark) {
    // フレームの中でも小さく残す。写真の上なら白、フレームの紙の上なら墨色。
    const onPhoto = opts.frame === "none" || opts.frame === "kanban";
    const size = Math.max(12, Math.round(Math.min(W, H) * 0.026));
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.shadowColor = onPhoto ? "rgba(0,0,0,0.55)" : "transparent";
    ctx.shadowBlur = onPhoto ? size * 0.4 : 0;
    ctx.fillStyle = onPhoto ? "rgba(255,255,255,0.88)" : "rgba(60,50,45,0.7)";
    const y = opts.frame === "kanban" ? img.y + img.h - size * 0.5 : H - size * 0.5;
    ctx.fillText("iekeiramen.com", W - size * 0.7, opts.frame === "receipt" ? H - size * 1.6 : y);
    ctx.shadowBlur = 0;
  }
  return img;
}
