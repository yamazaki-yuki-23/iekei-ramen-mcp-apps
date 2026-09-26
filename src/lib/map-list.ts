import type { Shop } from "./types";

/** 一覧に出す上限。地図モードの一覧は全件並べると長すぎる。 */
const LIST_LIMIT = 20;

/**
 * 地図モードの一覧に出す店。
 *
 * 全件並べると長すぎるので先頭 20 件で切る。ただしマーカーから選んだ店が
 * 20 件目より後ろだと詳細の置き場所が無くなるので、その店だけは先頭に持ってくる。
 *
 * **選んだ店は `all` から探す。** 塊を押して一覧を絞っているときに、その塊の
 * 外のマーカーを押すと、`shops` には居ないので入れ場所が無く、選んだのに
 * 詳細も「まわる店に追加」も消える。選択は地図のどこからでも起きるので、
 * 出す一覧が絞られていても、選んだ 1 軒だけは必ず載せる。
 */
export function mapListShops(shops: Shop[], selectedId?: string, all: Shop[] = shops): Shop[] {
  const head = shops.slice(0, LIST_LIMIT);
  if (!selectedId || head.some((s) => s.id === selectedId)) return head;
  const selected = all.find((s) => s.id === selectedId);
  return selected ? [selected, ...head.slice(0, LIST_LIMIT - 1)] : head;
}

/** 「この地点の 3 軒」。上限で切れているときだけ内訳を出す。 */
export function focusLabel(count: number): string {
  return count > LIST_LIMIT
    ? `この地点の ${count} 軒（${LIST_LIMIT} 件表示）`
    : `この地点の ${count} 軒`;
}
