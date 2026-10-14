import type { Shop } from "../lib/types";

/*
 * 家系カメラ（#190）の投稿文。**ひな形で作り、AI は使わない**（持っていない情報を足さない）。
 * 材料は店名・地域・利用者が選んだひとこと感想だけ。URL は入れない（本文に URL があると Threads で閲覧が落ちた、#44。
 * どこで作ったかは写真右下の「iekeiramen.com」で伝わる）。診断のタイプも入れない（オーナー判断）。アプリから店の評価（人気・おいしい・営業中）を足さない。
 * 文言はマーケティング担当と決める（見本の段階の案）。
 */

/** ひとこと感想の候補。利用者が選んだ言葉だけを文に入れる。 */
export const COMMENTS = [
  "最高だった",
  "また来たい",
  "沁みた",
  "完飲した",
  "ライスが止まらない",
] as const;

/** 判子にするときの短い言い方（ひとことと同じ意味のまま縮める）。 */
export const STAMP_OF: Record<(typeof COMMENTS)[number], string> = {
  最高だった: "最高",
  また来たい: "また来る",
  沁みた: "沁みた",
  完飲した: "完飲",
  ライスが止まらない: "ライス無限",
};

export type Tone = "plain" | "emo" | "neta";

export const TONES: { key: Tone; label: string }[] = [
  { key: "plain", label: "淡々" },
  { key: "emo", label: "エモ" },
  { key: "neta", label: "ネタ" },
];

export interface PostInput {
  shop: Pick<Shop, "name" | "city" | "prefecture">;
  comment?: string;
  tone: Tone;
}

const area = (shop: PostInput["shop"]) => shop.city ?? shop.prefecture;

/** ハッシュタグにできない文字（空白・記号）を外す。 */
export const tagOf = (text: string) => `#${text.replace(/[^\p{L}\p{N}_ー]/gu, "")}`;

/** 本文（タグの前）。調子ごとのひな形。 */
export function body({ shop, comment, tone }: PostInput): string {
  const said = comment ? `${comment}。` : "";
  switch (tone) {
    case "emo":
      return `湯気の向こうに、${shop.name}。${area(shop)}で一杯。${said}`;
    case "neta":
      return `本日の家系、${shop.name}（${area(shop)}）。${said}`;
    default:
      return `${area(shop)}の${shop.name}で一杯。${said}`;
  }
}

/** X 用: ハッシュタグを 3 つ（家系ラーメン・店名・地域）。 */
export function xText(input: PostInput): string {
  const tags = ["家系ラーメン", input.shop.name, area(input.shop)].map(tagOf);
  return `${body(input)}\n${[...new Set(tags)].join(" ")}`;
}

/** Threads 用: トピックタグは 1 つ（家系ラーメン）。 */
export function threadsText(input: PostInput): string {
  return `${body(input)}\n${tagOf("家系ラーメン")}`;
}
