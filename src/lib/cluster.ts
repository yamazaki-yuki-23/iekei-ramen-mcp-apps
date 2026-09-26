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

/**
 * 塊の印（36px）どうしが重ならない最低の間隔。
 *
 * **升目の識別だけで切ると、境目を挟んだ数 px の 2 軒が別々の塊になる。**
 * 印は重なって読めないのに、まとまってもいない——いちばん悪い形になる
 * （実測: 全国表示 zoom 5 で 5 組が重なり、最接近は 9.9px だった）。
 * 升目は下ごしらえで、最後に代表点どうしの距離で寄せ直す。
 */
const MIN_GAP_PX = 36;

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
  const groups = mergeClose([...cells.values()], zoom);
  return [...groups.map(toCluster), ...singles];
}

/**
 * 代表点が近すぎる塊どうしをまとめる。
 *
 * **1 組まとめるたびに測り直す。** まとめると代表点（平均）が動くので、
 * 一度に全部の組を見て消すと、動いた先でまた重なった組を取り逃がす。
 * 毎回いちばん先に見つかった組からまとめるので、結果は入力順で決まる。
 */
function mergeClose(groups: Shop[][], zoom: number): Shop[][] {
  const merged = [...groups];
  for (let pair = findClosePair(merged, zoom); pair; pair = findClosePair(merged, zoom)) {
    const [i, j] = pair;
    merged[i] = [...merged[i], ...merged[j]];
    merged.splice(j, 1);
  }
  return merged;
}

/** 近すぎる塊の組。無ければ null。 */
function findClosePair(groups: Shop[][], zoom: number): [number, number] | null {
  const centers = groups.map((group) => {
    const { lat, lon } = center(group);
    return project(lat, lon, zoom);
  });
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const gap = Math.hypot(centers[i].x - centers[j].x, centers[i].y - centers[j].y);
      if (gap < MIN_GAP_PX) return [i, j];
    }
  }
  return null;
}

function center(group: Shop[]): { lat: number; lon: number } {
  return { lat: average(group.map((s) => s.lat)), lon: average(group.map((s) => s.lon)) };
}

function toCluster(group: Shop[]): ShopCluster {
  return { ...center(group), shops: group };
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
