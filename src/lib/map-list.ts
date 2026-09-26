import type { Shop } from "./types";

/** 一覧に出す上限。地図モードの一覧は全件並べると長すぎる。 */
const LIST_LIMIT = 20;

/**
 * 地図モードの一覧に出す店。
 *
 * 全件並べると長すぎるので先頭 20 件で切る。ただしマーカーから選んだ店が
 * 20 件目より後ろだと詳細の置き場所が無くなるので、その店だけは先頭に持ってくる。
 *
 * **渡された一覧の中から探す。** 一時は「絞った一覧の外」も拾えるように
 * 全件も受けていたが、それだと塊を開いたまま外の店を選んだときに
 * 「この地点の 3 軒」の下へ 4 枚目が入り、見出しが嘘になる。外を選んだら
 * 塊の一覧ごと畳む（[ResultView](../components/ResultView.tsx)）ので、
 * ここは渡されたものだけを見ればよい。
 */
export function mapListShops(shops: Shop[], selectedId?: string): Shop[] {
  const head = shops.slice(0, LIST_LIMIT);
  if (!selectedId || head.some((s) => s.id === selectedId)) return head;
  const selected = shops.find((s) => s.id === selectedId);
  return selected ? [selected, ...head.slice(0, LIST_LIMIT - 1)] : head;
}

/** 「この地点の 3 軒」。上限で切れているときだけ内訳を出す。 */
export function focusLabel(count: number): string {
  return count > LIST_LIMIT
    ? `この地点の ${count} 軒（${LIST_LIMIT} 件表示）`
    : `この地点の ${count} 軒`;
}
