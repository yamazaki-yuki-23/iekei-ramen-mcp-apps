import type { Map as MapLibreMap } from "maplibre-gl";
import type { Shop } from "../../../types";

/**
 * 地図の上の印の絵（#246、デザイナーの 4 回目の案）。canvas で描いて地図に登録する
 * （外部のスプライトのファイルを持たない。会話の中は 1 枚の HTML なので）。
 *
 * 凡例（MapLegend）も同じ関数で描く。地図の印と凡例の絵がずれないようにするため。
 */

/** ピンの面の色（味の傾向）。未判定は醤油色（灰色にしない。劣った店に見せない）。 */
const PIN_COLORS: Record<Shop["taste"], string> = {
  rich: "#b8442c",
  creamy: "#c98a2e",
  chain: "#3f72aa",
  unknown: "#22150e",
};

/** ピンの下に添える味の言葉と、その文字の色。未判定には何も添えない（判定していない味を書かない）。 */
const TASTE_WORDS: Partial<Record<Shop["taste"], { word: string; ink: string }>> = {
  rich: { word: "濃厚", ink: "#9a3623" },
  creamy: { word: "クリーミー", ink: "#7a4f0e" },
  chain: { word: "チェーン", ink: "#2f5a8a" },
};

const TASTES = Object.keys(PIN_COLORS) as Shop["taste"][];
/** 順路の番号を絵にしておく上限。それより多い順路は、番号の札（DOM）だけで読ませる。 */
export const ROUTE_STOP_MAX = 12;
const RATIO = 2;
const FONT = `"Hiragino Maru Gothic ProN", "M PLUS Rounded 1c", "Hiragino Sans", sans-serif`;
const SHADOW = "rgba(34,21,14,.28)";

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

/** 大きさ w×h（CSS px）の絵を、2 倍の解像度で描く。 */
function paint(w: number, h: number, draw: Draw): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = w * RATIO;
  canvas.height = h * RATIO;
  const g = canvas.getContext("2d")!;
  g.scale(RATIO, RATIO);
  draw(g, w, h);
  return g.getImageData(0, 0, w * RATIO, h * RATIO);
}

/** 家系の丼（ファビコンの丼を単純にしたもの）。 */
function bowl(g: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.fillStyle = "#fff";
  g.beginPath();
  g.roundRect(-9, -3, 18, 3, 1.5);
  g.fill();
  g.beginPath();
  g.moveTo(-8, 0);
  g.lineTo(8, 0);
  g.quadraticCurveTo(7.5, 8, 0, 8);
  g.quadraticCurveTo(-7.5, 8, -8, 0);
  g.fill();
  g.fillRect(-3, 7.5, 6, 2);
  g.restore();
}

/** 丸い面（影・白い縁 2.5px・味の色）。 */
function face(g: CanvasRenderingContext2D, c: number, fill: string, r: number) {
  g.fillStyle = SHADOW;
  g.beginPath();
  g.arc(c, c + 2, r + 1, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(c, c, r + 2.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = fill;
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.fill();
}

function text(g: CanvasRenderingContext2D, x: number, y: number, s: string, px: number) {
  g.fillStyle = "#fff";
  g.font = `700 ${px}px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(s, x, y + 0.5);
}

/** 店のピン。見た目は直径 32px（縁を入れて 37px）、絵は 44px（押せる範囲）。 */
export const drawPin =
  (taste: Shop["taste"], stop = 0): Draw =>
  (g) => {
    face(g, 22, PIN_COLORS[taste], 16);
    // 順路の店は、丼の代わりに番号を入れる（番号の札をピンに重ねない）。
    if (stop > 0) text(g, 22, 22, String(stop), stop > 9 ? 15 : 19);
    else bowl(g, 22, 20, 0.95);
  };

/** 選択中: しずく形（先端が店の位置）。 */
export const drawSelected =
  (taste: Shop["taste"], stop = 0): Draw =>
  (g) => {
    const drop = (r: number, cy: number) => {
      g.beginPath();
      g.arc(30, cy, r, Math.PI * 0.78, Math.PI * 2.22);
      g.lineTo(30, cy + r * 1.8);
      g.closePath();
    };
    g.fillStyle = SHADOW;
    g.save();
    g.translate(1.5, 2.5);
    drop(21, 23);
    g.fill();
    g.restore();
    g.fillStyle = "#fff";
    drop(22.5, 22);
    g.fill();
    g.fillStyle = PIN_COLORS[taste];
    drop(19, 22);
    g.fill();
    // 順路に入っている店を選んだときも、何軒目かが読めるよう番号を入れる。
    if (stop > 0) text(g, 30, 22, String(stop), stop > 9 ? 17 : 21);
    else bowl(g, 30, 20, 1.2);
  };

/** 塊の大きさ（件数で 3 段）。 */
export const CLUSTER_SIZES = [
  ["s", 16],
  ["m", 20],
  ["l", 25],
] as const;

/** 塊: 丸を 2 枚ずらして重ねた形（「何軒かがまとまっている」を形で示す）。 */
export const drawCluster =
  (r: number): Draw =>
  (g, w) => {
    const c = w / 2;
    g.fillStyle = "rgba(34,21,14,.25)";
    g.beginPath();
    g.arc(c, c + 2, r, 0, Math.PI * 2);
    g.fill();
    for (const [dx, dy, fill] of [
      [4, -4, "#e89d87"],
      [0, 0, "#b8442c"],
    ] as const) {
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(c + dx, c + dy, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = fill;
      g.beginPath();
      g.arc(c + dx, c + dy, r - 2.5, 0, Math.PI * 2);
      g.fill();
    }
  };

/**
 * 行った店の印（デザイナーの見本）: 醤油色の丸（直径 15px）に白い縁 2px、中に白いチェック。全体で 19px。
 * 白い丸だと白い縁のピンと混ざり、生成りの地の上で輪郭がぼやける。(cx, cy) は印の中心。
 */
function badge(g: CanvasRenderingContext2D, cx: number, cy: number) {
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(cx, cy, 9.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#22150e";
  g.beginPath();
  g.arc(cx, cy, 7.5, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#fff";
  g.lineWidth = 2;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(cx - 3.5, cy + 0.2);
  g.lineTo(cx - 1, cy + 2.5);
  g.lineTo(cx + 3.5, cy - 2.5);
  g.stroke();
}

const drawVisited: Draw = (g) => badge(g, 10, 10);

/** 凡例の絵: 行った店（未判定のピンの右上に印）。 */
export const drawVisitedPin: Draw = (g, w, h) => {
  drawPin("unknown")(g, w, h);
  badge(g, 22 + 13, 22 - 13);
};

/** 味の言葉（白い縁取りの文字だけ。札にするとピンより目立つ）。 */
function wordImage(word: string, ink: string): ImageData {
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = `700 12px ${FONT}`;
  const w = Math.ceil(probe.measureText(word).width) + 8;
  return paint(w, 18, (g) => {
    g.font = `700 12px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.lineWidth = 4;
    g.strokeStyle = "#fff";
    g.strokeText(word, w / 2, 9.5);
    g.fillStyle = ink;
    g.fillText(word, w / 2, 9.5);
  });
}

/** 駅名の札（券売機のボタンの形を残しつつ弱める。影なし・淡い縁）。伸ばして使う。 */
const drawKey: Draw = (g) => {
  g.fillStyle = "#fff";
  g.beginPath();
  g.roundRect(1, 1, 22, 20, 5);
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = "#b9ab95";
  g.beginPath();
  g.roundRect(1.5, 1.5, 21, 19, 4.5);
  g.stroke();
};

/** 地図に印の絵を全部登録する。スタイルを読み込み直したときも呼ぶ。 */
export function addMapImages(map: MapLibreMap): void {
  const add = (id: string, w: number, h: number, draw: Draw, opts = {}) => {
    if (!map.hasImage(id)) map.addImage(id, paint(w, h, draw), { pixelRatio: RATIO, ...opts });
  };
  for (const taste of TASTES) {
    add(`pin-${taste}`, 44, 44, drawPin(taste));
    for (let n = 1; n <= ROUTE_STOP_MAX; n++) add(`stop-${taste}-${n}`, 44, 44, drawPin(taste, n));
    add(`sel-${taste}`, 60, 60, drawSelected(taste));
    for (let n = 1; n <= ROUTE_STOP_MAX; n++)
      add(`sel-${taste}-${n}`, 60, 60, drawSelected(taste, n));
    const word = TASTE_WORDS[taste];
    if (word && !map.hasImage(`word-${taste}`))
      map.addImage(`word-${taste}`, wordImage(word.word, word.ink), { pixelRatio: RATIO });
  }
  for (const [size, r] of CLUSTER_SIZES)
    add(`cluster-${size}`, r * 2 + 14, r * 2 + 14, drawCluster(r));
  add("visited", 20, 20, drawVisited);
  add("key", 24, 24, drawKey, {
    stretchX: [[7 * RATIO, 17 * RATIO]],
    stretchY: [[7 * RATIO, 15 * RATIO]],
    content: [6 * RATIO, 4 * RATIO, 18 * RATIO, 18 * RATIO],
  });
}

/** 凡例で使う絵（地図の印と同じ描き方）。data URL で返す。 */
export function imageUrl(w: number, h: number, draw: Draw): string {
  const canvas = document.createElement("canvas");
  canvas.width = w * RATIO;
  canvas.height = h * RATIO;
  canvas.getContext("2d")!.putImageData(paint(w, h, draw), 0, 0);
  return canvas.toDataURL();
}
