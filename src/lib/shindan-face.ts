import type { TypeKey } from "./shindan";

/*
 * 家系タイプ診断（#167）の丼のキャラクター。丼は同じで、タイプごとに表情と小物だけを変える。
 * 画面（React）とシェア画像（scripts/shindan-og.mjs）の両方が、この形のデータから SVG を描く。
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

const FACES: Record<TypeKey, Shape[]> = {
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

export const faceShapes = (key: TypeKey): Shape[] => [...BOWL, ...FACES[key]];

/** シェア画像用の SVG の文字列。 */
export function faceSvg(key: TypeKey, size: number): string {
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
