/**
 * テストが当てにする数字を、データから導く。
 *
 * **店舗データの件数をテストへ書き込まない。** 取得し直すたびに動くので、
 * 「全国 558 件」「神奈川県は 79 軒」と書くとデータを更新しただけで落ちる
 * （実際に unit 3 本・E2E 6 本が落ちた）。見たい性質は件数そのものではなく、
 * 「全部が地図に出ている」「範囲が効いたままだ」といった関係のほう。
 *
 * ここはサーバーの絞り込みを写す場所ではない。**書いてよいのは、tool の
 * 引数から誰が見ても決まるもの**（枠の内側か、都道府県が一致するか）だけ。
 * 家系判定の段階で母集団を変えるような規則は server 側にしか置かない。
 */
import shopsData from "../data/shops.json" with { type: "json" };

interface DatasetShop {
  id: string;
  prefecture: string;
  lat: number;
  lon: number;
  taste: string;
  confidence: string;
}

const SHOPS = shopsData as DatasetShop[];

/** 地図に出るはずの全件。 */
export const TOTAL = SHOPS.length;

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/** 枠の内側か。tool の引数どおりの意味で、ここに独自の解釈を足さない。 */
const inBounds = (shop: DatasetShop, b: Bounds): boolean =>
  shop.lat <= b.north && shop.lat >= b.south && shop.lon <= b.east && shop.lon >= b.west;

/** 条件に当てはまる件数。 */
export function countShops(filter: {
  prefecture?: string;
  taste?: string;
  bounds?: Bounds;
}): number {
  return SHOPS.filter(
    (s) =>
      (!filter.prefecture || s.prefecture === filter.prefecture) &&
      (!filter.taste || s.taste === filter.taste) &&
      (!filter.bounds || inBounds(s, filter.bounds)),
  ).length;
}
