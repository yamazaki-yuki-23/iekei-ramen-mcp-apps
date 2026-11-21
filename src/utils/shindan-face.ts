import type { TypeKey } from "./shindan";
import type { TypeKey as V2TypeKey } from "./shindan-v2";
import type { AnyTypeKey } from "./shindan-editions";

/*
 * 家系タイプ診断（#167）の丼のキャラクター。丼は同じで、タイプごとに表情と小物だけを変える。
 * 画面（React）とシェア画像（scripts/assets/shindan-og.mjs）の両方が、この形のデータから SVG を描く。
 */

export interface Shape {
  tag: "path" | "circle" | "ellipse" | "rect";
  attrs: Record<string, string | number>;
}

const INK = "#211814";
const LINE = { fill: "none", stroke: "#fff6ea", "stroke-width": 4, "stroke-linecap": "round" };
const DOT = { fill: "#fff6ea" };
const GOLD = { fill: "#e0a526", stroke: INK, "stroke-width": 2.5, "stroke-linejoin": "round" };

const line = (d: string): Shape => ({ tag: "path", attrs: { d, ...LINE } });
const dot = (cx: number, cy: number, r = 3.8): Shape => ({
  tag: "circle",
  attrs: { cx, cy, r, ...DOT },
});
const eyes = [dot(44, 63), dot(76, 63)];

/** 丼（海苔・箸・スープ・器）。表情はこの上に描く。 */
const BOWL: Shape[] = [
  {
    tag: "path",
    attrs: {
      d: "M70 4 L96 40 M80 2 L104 36",
      stroke: INK,
      "stroke-width": 4,
      "stroke-linecap": "round",
    },
  },
  {
    tag: "rect",
    attrs: {
      x: 24,
      y: 16,
      width: 22,
      height: 30,
      rx: 2,
      fill: "#2f3a2c",
      stroke: INK,
      "stroke-width": 2.5,
    },
  },
  {
    tag: "ellipse",
    attrs: { cx: 60, cy: 44, rx: 50, ry: 8, fill: "#e9c48a", stroke: INK, "stroke-width": 3 },
  },
  {
    tag: "path",
    attrs: {
      d: "M10 44 A50 46 0 0 0 110 44 Z",
      fill: "#b8442c",
      stroke: INK,
      "stroke-width": 3.5,
      "stroke-linejoin": "round",
    },
  },
  {
    tag: "rect",
    attrs: {
      x: 42,
      y: 88,
      width: 36,
      height: 9,
      rx: 3,
      fill: "#b8442c",
      stroke: INK,
      "stroke-width": 3,
    },
  },
];

const V1_FACES: Record<TypeKey, Shape[]> = {
  // 王冠をかぶって、目を細めて大きく笑う。
  sankan: [
    { tag: "path", attrs: { d: "M42 30 L46 14 L54 24 L60 10 L66 24 L74 14 L78 30 Z", ...GOLD } },
    line("M37 65 Q44 57 51 65"),
    line("M69 65 Q76 57 83 65"),
    { tag: "path", attrs: { d: "M48 72 Q60 86 72 72 Z", fill: "#fff6ea" } },
  ],
  // 落ち着いた目と、小さな笑み。
  futsuu: [...eyes, line("M52 76 Q60 80 68 76")],
  // 眉をつり上げ、口を開けて、横に炎。
  fullthrottle: [
    line("M36 55 L50 59"),
    line("M84 55 L70 59"),
    ...eyes,
    { tag: "ellipse", attrs: { cx: 60, cy: 77, rx: 7, ry: 5, fill: "#fff6ea" } },
    { tag: "path", attrs: { d: "M104 50 C96 40 104 32 102 22 C112 30 116 42 104 50 Z", ...GOLD } },
    { tag: "path", attrs: { d: "M16 50 C24 42 16 34 18 26 C8 34 6 44 16 50 Z", ...GOLD } },
  ],
  // 片目をつぶって、口の端を上げる。きらりと 1 つ。
  itten: [
    line("M37 64 Q44 59 51 64"),
    dot(76, 63),
    line("M52 77 Q64 80 70 72"),
    {
      tag: "path",
      attrs: { d: "M100 18 L103 26 L111 29 L103 32 L100 40 L97 32 L89 29 L97 26 Z", ...GOLD },
    },
  ],
  // まっすぐな眉と、結んだ口。
  katame: [line("M36 56 L51 58"), line("M84 56 L69 58"), ...eyes, line("M52 77 L68 77")],
  // 半分閉じた目で、静かに笑う。れんげを 1 本。
  sajikagen: [
    line("M37 63 L51 63"),
    line("M69 63 L83 63"),
    line("M52 75 Q60 80 68 75"),
    {
      tag: "path",
      attrs: {
        d: "M98 12 C108 10 112 18 106 24 L100 34 L96 32 L100 22 C94 18 94 14 98 12 Z",
        fill: "#f6efe6",
        stroke: INK,
        "stroke-width": 2.5,
      },
    },
  ],
  // 目を閉じて、頬を赤らめる。
  yasashi: [
    line("M37 62 Q44 68 51 62"),
    line("M69 62 Q76 68 83 62"),
    { tag: "ellipse", attrs: { cx: 34, cy: 72, rx: 6, ry: 3.5, fill: "#f2a3a3" } },
    { tag: "ellipse", attrs: { cx: 86, cy: 72, rx: 6, ry: 3.5, fill: "#f2a3a3" } },
    line("M53 76 Q60 81 67 76"),
  ],
  // 大きさの違う目と、波の口。横に火花。
  garyu: [
    dot(44, 63, 5.5),
    dot(77, 64, 2.6),
    line("M47 77 Q51 73 55 77 Q59 81 63 77 Q67 73 71 77"),
    {
      tag: "path",
      attrs: {
        d: "M104 20 L106 28 M98 26 L104 30 M112 26 L106 30",
        stroke: "#e0a526",
        "stroke-width": 3.5,
        "stroke-linecap": "round",
      },
    },
  ],
};

const STAR = (x: number, y: number, r: number): Shape => ({
  tag: "path",
  attrs: {
    d: `M${x} ${y - r} L${x + r * 0.3} ${y - r * 0.3} L${x + r} ${y} L${x + r * 0.3} ${y + r * 0.3} L${x} ${y + r} L${x - r * 0.3} ${y + r * 0.3} L${x - r} ${y} L${x - r * 0.3} ${y - r * 0.3} Z`,
    ...GOLD,
  },
});
const WISP = (d: string): Shape => ({
  tag: "path",
  attrs: { d, fill: "none", stroke: "#a39a92", "stroke-width": 3, "stroke-linecap": "round" },
});

/** 2 版（#410）の顔。デザイナーが描いたもの。 */
const V2_FACES: Record<V2TypeKey, Shape[]> = {
  // 巻く・足す・変える。目を細めて大きく笑い、左上にきらりと 3 つ。
  sansoryu: [
    line("M37 65 Q44 57 51 65"),
    line("M69 65 Q76 57 83 65"),
    { tag: "path", attrs: { d: "M48 72 Q60 86 72 72 Z", fill: "#fff6ea" } },
    STAR(12, 12, 6),
    STAR(7, 28, 4.5),
    STAR(17, 38, 3.5),
  ],
  // 店が決めた一杯をそのまま。目を閉じて味わい、湯気が 3 本。
  chakudon: [
    line("M37 62 Q44 67 51 62"),
    line("M69 62 Q76 67 83 62"),
    line("M54 76 Q60 79 66 76"),
    WISP("M52 34 Q48 28 52 22 Q56 16 52 10"),
    WISP("M60 32 Q56 26 60 20 Q64 14 60 8"),
    WISP("M68 34 Q64 28 68 22"),
  ],
  // 具も味変も遠慮しない。星の目と、大きく開けた口。
  yokubari: [
    STAR(44, 63, 6.5),
    STAR(76, 63, 6.5),
    { tag: "path", attrs: { d: "M44 71 Q60 93 76 71 Z", fill: "#fff6ea" } },
  ],
  // スープと向き合う。目を伏せて、小さくすする口。れんげをスープに。
  soup: [
    line("M37 65 L51 65"),
    line("M69 65 L83 65"),
    { tag: "ellipse", attrs: { cx: 60, cy: 77, rx: 3.5, ry: 4, fill: "#fff6ea" } },
    {
      tag: "path",
      attrs: {
        d: "M54 22 L62 34 Q70 36 72 44 L54 44 Q52 38 58 35 L50 24 Z",
        fill: "#fffaf2",
        stroke: INK,
        "stroke-width": 2.5,
        "stroke-linejoin": "round",
      },
    },
  ],
  // 主役はライス。にっこり笑い、左上に海苔を巻いたライスの小さな茶碗。
  norimaki: [
    line("M37 64 Q44 58 51 64"),
    line("M69 64 Q76 58 83 64"),
    line("M50 75 Q60 83 70 75"),
    {
      tag: "path",
      attrs: { d: "M3 28 Q12 12 21 28 Z", fill: "#fffaf2", stroke: INK, "stroke-width": 2.2 },
    },
    { tag: "rect", attrs: { x: 9, y: 17, width: 7, height: 11, rx: 1, fill: "#2f3a2c" } },
    {
      tag: "path",
      attrs: {
        d: "M1 28 L23 28 A11 10 0 0 1 1 28 Z",
        fill: "#f6efe6",
        stroke: INK,
        "stroke-width": 2.5,
        "stroke-linejoin": "round",
      },
    },
  ],
  // 一つだけ足す加減を知っている。片眉を上げた笑みと、ひとしずく。
  choitashi: [
    line("M37 55 L51 53"),
    ...eyes,
    line("M52 77 Q62 80 69 73"),
    {
      tag: "path",
      attrs: {
        d: "M112 10 C116 17 118 21 118 24 A6 6 0 0 1 106 24 C106 21 108 17 112 10 Z",
        ...GOLD,
      },
    },
  ],
  // 丼のふちまで具。チャーシュー・ほうれん草・うずらを丼の上に。大きく笑う。
  zenbunose: [
    {
      tag: "ellipse",
      attrs: { cx: 66, cy: 36, rx: 16, ry: 10, fill: "#c98a5a", stroke: INK, "stroke-width": 2.5 },
    },
    {
      tag: "ellipse",
      attrs: {
        cx: 66,
        cy: 36,
        rx: 8,
        ry: 4.5,
        fill: "none",
        stroke: INK,
        "stroke-width": 1.5,
        opacity: 0.5,
      },
    },
    {
      tag: "path",
      attrs: {
        d: "M80 42 Q82 26 92 30 Q102 26 100 41 Z",
        fill: "#3f7a3a",
        stroke: INK,
        "stroke-width": 2.5,
        "stroke-linejoin": "round",
      },
    },
    {
      tag: "circle",
      attrs: { cx: 50, cy: 38, r: 7, fill: "#fffaf2", stroke: INK, "stroke-width": 2.2 },
    },
    line("M37 64 Q44 57 51 64"),
    line("M69 64 Q76 57 83 64"),
    { tag: "path", attrs: { d: "M48 72 Q60 86 72 72 Z", fill: "#fff6ea" } },
  ],
  // 実験の時間。丸めがねと、左上にフラスコ。
  takujo: [
    {
      tag: "circle",
      attrs: { cx: 44, cy: 63, r: 9, fill: "none", stroke: "#fff6ea", "stroke-width": 3 },
    },
    {
      tag: "circle",
      attrs: { cx: 76, cy: 63, r: 9, fill: "none", stroke: "#fff6ea", "stroke-width": 3 },
    },
    line("M53 63 L67 63"),
    ...eyes,
    line("M53 78 Q60 81 67 77"),
    {
      tag: "path",
      attrs: {
        d: "M10 10 L18 10 M12 10 L12 22 L5 36 Q4 39 7 39 L21 39 Q24 39 23 36 L16 22 L16 10",
        fill: "#fffaf2",
        stroke: INK,
        "stroke-width": 2.5,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      },
    },
    {
      tag: "path",
      attrs: { d: "M8 32 L20 32 L22.5 36.5 Q23 38 21 38 L7 38 Q5 38 5.5 36.5 Z", fill: "#e0a526" },
    },
  ],
};

const FACES: Record<AnyTypeKey, Shape[]> = { ...V1_FACES, ...V2_FACES };

export const faceShapes = (key: AnyTypeKey): Shape[] => [...BOWL, ...FACES[key]];

/** シェア画像用の SVG の文字列。 */
export function faceSvg(key: AnyTypeKey, size: number): string {
  const body = faceShapes(key)
    .map(
      (s) =>
        `<${s.tag} ${Object.entries(s.attrs)
          .map(([k, v]) => `${k}="${v}"`)
          .join(" ")}/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width="${size}" height="${Math.round((size * 100) / 120)}">${body}</svg>`;
}
