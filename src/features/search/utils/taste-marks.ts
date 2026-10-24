import type { Shop } from "../../../types";

/*
 * 味の印の色と言葉（#246 の地図のピン、#255 の一覧の 2 行目）。地図の絵（lib/map-images.ts）と
 * 一覧（ShopList）の両方がここから読む。片方だけ直して色や言葉がずれないようにするため。
 */

/** ピンの面の色（味の傾向）。未判定は醤油色（灰色にしない。劣った店に見せない）。 */
export const PIN_COLORS: Record<Shop["taste"], string> = {
  rich: "#b8442c",
  creamy: "#c98a2e",
  chain: "#3f72aa",
  unknown: "#22150e",
};

/** 味の言葉と、その文字の色。未判定には何も添えない（判定していない味を書かない）。 */
export const TASTE_WORDS: Partial<Record<Shop["taste"], { word: string; ink: string }>> = {
  rich: { word: "濃厚", ink: "#9a3623" },
  creamy: { word: "クリーミー", ink: "#7a4f0e" },
  chain: { word: "チェーン", ink: "#2f5a8a" },
};
