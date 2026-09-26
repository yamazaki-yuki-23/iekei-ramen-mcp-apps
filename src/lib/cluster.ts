import type { Shop } from "./types";

/**
 * 地図のマーカーをまとめる。
 *
 * 東京 162 件・神奈川 121 件が同じ場所に重なると、その範囲の情報量は
 * 実質ゼロになる（何軒あるのかも、どれを押しているのかも分からない）。
 *
 * **画面上の距離でまとめる。緯度経度の差ではない。** 経度 1 度の長さは
 * 緯度で変わるので、度数で切ると北と南で塊の大きさが変わる。ズームごとの
 * ピクセル座標に直してから正方形に切る。
 *
 * **並びは入力順を保つ。** 同じ条件なら毎回同じ塊・同じ順で返るので、
 * 見た目もテストも安定する（「まわる店」で乱数を使わないのと同じ理由）。
 */

/** 1 つの塊と見なす画面上の正方形の一辺（px）。 */
const CELL_PX = 64;

/** タイル 1 枚の大きさ。Web メルカトルの座標をピクセルに直すのに使う。 */
const TILE_PX = 256;

export interface ShopCluster {
  /** 代表点。集まった店の平均で、実在の店の位置とは限らない。 */
  lat: number;
  lon: number;
  shops: Shop[];
}

/** Web メルカトルのピクセル座標。Leaflet の `map.project` と同じ定義。 */
function project(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const scale = TILE_PX * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  // 極付近で無限大にならないよう、メルカトルの有効範囲に丸めてから計算する。
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

/**
 * ズームに応じて店をまとめる。
 *
 * `keepId` の店だけは 1 軒でも単独で返す。選択中の店が塊に飲まれると、
 * 選んだ手応えが消えて、地図とパネルのどちらを見ても位置が分からなくなる。
 */
export function clusterShops(shops: Shop[], zoom: number, keepId?: string): ShopCluster[] {
  const cells = new Map<string, Shop[]>();
  const singles: ShopCluster[] = [];

  for (const shop of shops) {
    if (shop.id === keepId) {
      singles.push({ lat: shop.lat, lon: shop.lon, shops: [shop] });
      continue;
    }
    const { x, y } = project(shop.lat, shop.lon, zoom);
    const key = `${Math.floor(x / CELL_PX)}:${Math.floor(y / CELL_PX)}`;
    const cell = cells.get(key);
    if (cell) cell.push(shop);
    else cells.set(key, [shop]);
  }

  // Map は挿入順を保つので、入力順のまま返る。
  const clustered = [...cells.values()].map((group) => ({
    lat: average(group.map((s) => s.lat)),
    lon: average(group.map((s) => s.lon)),
    shops: group,
  }));

  return [...clustered, ...singles];
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
