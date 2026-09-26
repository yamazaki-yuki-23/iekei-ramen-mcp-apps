import type { Bounds } from "./types";

/**
 * 結果が「どこ」のものかを表す語。
 *
 * **UI の見出しとモデルへの文で同じものを使う。** 別々に書くと、画面には
 * 「全国の家系ラーメン 489 件」と出ているのにモデルは「地図に出ている範囲」と
 * 話す、という食い違いが起きる（実際にそうなっていた）。
 *
 * **効いている条件はすべて名乗る。** 範囲と都道府県は同時に効くことがあり
 * （モデルは両方付きで tool を呼べる）、そのとき絞り込みは両方の重なりになる。
 * 範囲だけを名乗ると、枠が県境をまたいでいた場合に、県の外の店が黙って
 * 落ちているのに「見えている範囲の全部」と読めてしまう。
 */
export function scopeLabel(query: { prefecture?: string; bounds?: Bounds }): string {
  if (query.bounds) {
    return query.prefecture ? `地図に出ている範囲（${query.prefecture}）` : "地図に出ている範囲";
  }
  return query.prefecture ?? "全国";
}
