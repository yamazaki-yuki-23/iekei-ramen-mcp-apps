import type { OriginSource } from "../types";

export const TASTES = {
  rich: { label: "直系・濃厚", description: "豚骨醤油が強い、classic な家系" },
  creamy: { label: "クリーミー", description: "まろやかでとろみのあるスープ" },
  chain: { label: "チェーン・万人向け", description: "食べやすくどこでも入りやすい" },
  unknown: { label: "味は未判定", description: "傾向を判定できなかった店舗" },
} as const;

/**
 * 家系判定の段階。
 *
 * 「家系ではない」と「家系かどうか分からない」は別物なので分けている。
 * 前者はそもそも一覧に載せず、後者が candidate。店名しか手がかりが無い店は
 * 実際に多く、likely に混ぜると「たぶん家系」と読めてしまう。
 */
/**
 * **「店名が」と限定しないこと。** 名乗りは店名だけに書かれているとは限らず、
 * 地図の `description` や `cuisine:ja` に「横浜家系ラーメン」とある店も確定になる
 * （実測 11 件）。ここは UI のバッジだけでなく、[shop-brief](./shop-brief.ts) が
 * **モデルへ渡す説明文**でもある。店名を見ても家系と書いていない店について
 * 「店名が名乗っている」と伝えると、判定の理由を偽って渡すことになる。
 */
export const CONFIDENCE = {
  confirmed: {
    label: "家系",
    description: "地図の記載が家系を名乗っている、または既知の家系ブランド",
  },
  likely: {
    label: "家系の可能性",
    description: "名乗ってはいないが、記載から家系と推定できる",
  },
  candidate: {
    label: "家系か未判定",
    description: "ラーメン店で屋号が「〜家」だが、家系かどうかは記載から判断できない",
  },
} as const;

export const ORIGIN_NOTES: Record<OriginSource, string> = {
  precise: "現在地",
  host: "だいたいの位置（市区町村レベル）",
  edge: "接続元からの推定（市区町村レベル）",
  place: "指定した地名",
};
