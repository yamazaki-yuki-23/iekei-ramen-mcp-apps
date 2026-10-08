import type { Shop } from "./types";

/** ブランドと、判定した結果の軒数。 */
export interface BrandCount {
  name: string;
  count: number;
}

/**
 * 店名の券売機に並べるブランド（#144）。判定した結果の軒数が多い順に、上から n 個。
 *
 * 軒数が同じなら名前の順にする（乱数を使わない。同じデータなら同じ並び）。
 * 全国の総数ではなく、地図データを判定した結果の軒数であることを画面で言う。
 */
export function topBrands(shops: Shop[], n = 8): BrandCount[] {
  const counts = new Map<string, number>();
  for (const shop of shops) {
    if (shop.brand) counts.set(shop.brand, (counts.get(shop.brand) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"))
    .slice(0, n);
}
