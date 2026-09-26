import type { Bounds } from "./types";

/**
 * 結果が「どこ」のものかを表す語。
 *
 * **UI の見出しとモデルへの文で同じものを使う。** 別々に書くと、画面には
 * 「全国の家系ラーメン 489 件」と出ているのにモデルは「地図に出ている範囲」と
 * 話す、という食い違いが起きる（実際にそうなっていた）。
 *
 * 範囲が最優先。いちばん狭く、いま目に見えている条件だから。
 */
export function scopeLabel(query: { prefecture?: string; bounds?: Bounds }): string {
  if (query.bounds) return "地図に出ている範囲";
  return query.prefecture ?? "全国";
}
