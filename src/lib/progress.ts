import type { Shop } from "./types";

/**
 * 制覇率。
 *
 * **持っている情報だけで数える。** 行った店の数と、全体の数と、その割合。
 * 「あと何軒」も出せるが、**順位や称号は作らない**——このデータには評価が
 * 無いので、頑張りの度合いを語る材料が無い。
 */
interface Progress {
  visited: number;
  total: number;
  /** 0〜100。小数第 1 位まで。 */
  percent: number;
}

interface PrefectureProgress extends Progress {
  prefecture: string;
}

export interface VisitSummary {
  overall: Progress;
  /** 訪問した県だけ。**0 軒の県は並べない**——47 行の 0 は読むのが苦痛なだけ。 */
  prefectures: PrefectureProgress[];
}

function ratio(visited: number, total: number): Progress {
  return {
    visited,
    total,
    percent: total === 0 ? 0 : Number(((visited / total) * 100).toFixed(1)),
  };
}

/**
 * 訪問済みの店 ID から制覇率を作る。
 *
 * **店舗データにもう無い ID は数えない。** データを取り直すと店が消えることが
 * あり、その分を数えると「行った数 > 全体の数」になりうる。記録自体は消さない
 * （店が戻ってくるかもしれないので）。
 */
export function summarize(shops: Shop[], visitedIds: Iterable<string>): VisitSummary {
  const visited = new Set(visitedIds);
  const byPrefecture = new Map<string, { visited: number; total: number }>();

  let overallVisited = 0;
  for (const shop of shops) {
    const row = byPrefecture.get(shop.prefecture) ?? { visited: 0, total: 0 };
    row.total += 1;
    if (visited.has(shop.id)) {
      row.visited += 1;
      overallVisited += 1;
    }
    byPrefecture.set(shop.prefecture, row);
  }

  const prefectures = [...byPrefecture.entries()]
    .filter(([, row]) => row.visited > 0)
    // 行った数の多い順。同数なら県名で並べ、結果を決定的にする。
    .toSorted(([aName, a], [bName, b]) => b.visited - a.visited || aName.localeCompare(bName))
    .map(([prefecture, row]) => ({ prefecture, ...ratio(row.visited, row.total) }));

  return { overall: ratio(overallVisited, shops.length), prefectures };
}
