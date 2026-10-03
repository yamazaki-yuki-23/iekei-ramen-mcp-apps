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
  return [
    ...groups.map((group) => ({
      lat: group.latSum / group.count,
      lon: group.lonSum / group.count,
      shops: group.shops,
    })),
    ...singles,
  ];
}

interface Group {
  shops: Shop[];
  count: number;
  latSum: number;
  lonSum: number;
  x: number;
  y: number;
  /** 最初の升目の入力順。削除で番号を詰めなくても、最初の組の順序は変わらない。 */
  order: number;
  active: boolean;
}

function groupOf(shops: Shop[], order: number, zoom: number): Group {
  let latSum = 0;
  let lonSum = 0;
  for (const shop of shops) {
    latSum += shop.lat;
    lonSum += shop.lon;
  }
  const { x, y } = project(latSum / shops.length, lonSum / shops.length, zoom);
  return { shops, count: shops.length, latSum, lonSum, x, y, order, active: true };
}

/**
 * 代表点が近すぎる塊どうしをまとめる。
 *
 * **1 組まとめるたびに測り直す。** まとめると代表点（平均）が動くので、
 * 一度に全部の組を見て消すと、動いた先でまた重なった組を取り逃がす。
 * 毎回いちばん先に見つかった組からまとめるので、結果は入力順で決まる。
 */
// 中心を保持し、統合した側だけを計算し直す。
function mergeClose(shops: Shop[][], zoom: number): Group[] {
  const groups = shops.map((group, order) => groupOf(group, order, zoom));
  // 少ない塊では索引を作る手間の方が大きい。全国表示のような小さい一覧は直接見る。
  const nearby = groups.length > 32 ? new Nearby(groups) : undefined;
  for (let pair = findClosePair(groups, nearby); pair; pair = findClosePair(groups, nearby)) {
    const [left, right] = pair;
    nearby?.remove(left);
    nearby?.remove(right);
    // 合計どうしを足すと丸め方が変わる。右の店を順番に加え、元のreduceと完全一致させる。
    for (const shop of right.shops) {
      left.shops.push(shop);
      left.latSum += shop.lat;
      left.lonSum += shop.lon;
    }
    left.count += right.count;
    const center = project(left.latSum / left.count, left.lonSum / left.count, zoom);
    left.x = center.x;
    left.y = center.y;
    right.active = false;
    nearby?.add(left);
  }
  return groups.filter((group) => group.active);
}

/** 少ない塊だけは全組を見る。中心の投影は再計算しない。 */
function findClosePair(groups: Group[], nearby?: Nearby): [Group, Group] | null {
  for (let i = 0; i < groups.length; i++) {
    const first = groups[i];
    if (!first.active) continue;
    if (nearby) {
      const second = nearby.firstClose(first);
      if (second) return [first, second];
      continue;
    }
    for (let j = i + 1; j < groups.length; j++) {
      const second = groups[j];
      if (second.active && isClose(first, second)) return [first, second];
    }
  }
  return null;
}

function isClose(first: Group, second: Group): boolean {
  // 境界の判定も元と同じhypotを使う。二乗比較による丸め方の差を入れない。
  const gap = Math.hypot(first.x - second.x, first.y - second.y);
  return gap < MIN_GAP_PX;
}

/** 36px以内の候補は、36pxの升目の同じセルか隣接する8セルにしかいない。 */
class Nearby {
  private cells = new Map<string, Set<Group>>();

  constructor(groups: Group[]) {
    for (const group of groups) this.add(group);
  }

  add(group: Group) {
    const key = this.key(group);
    const cell = this.cells.get(key);
    if (cell) cell.add(group);
    else this.cells.set(key, new Set([group]));
  }

  remove(group: Group) {
    const key = this.key(group);
    const cell = this.cells.get(key);
    cell?.delete(group);
    if (cell?.size === 0) this.cells.delete(key);
  }

  firstClose(first: Group): Group | undefined {
    const x = Math.floor(first.x / MIN_GAP_PX);
    const y = Math.floor(first.y / MIN_GAP_PX);
    let closestInOrder: Group | undefined;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = this.cells.get(`${x + dx}:${y + dy}`);
        if (!cell) continue;
        for (const candidate of cell) {
          if (candidate.order <= first.order) continue;
          if (closestInOrder && candidate.order >= closestInOrder.order) continue;
          // 空間索引の順で決めない。元の入力順でいちばん先の組を返す。
          if (isClose(first, candidate)) closestInOrder = candidate;
        }
      }
    }
    return closestInOrder;
  }

  private key(group: Group): string {
    return `${Math.floor(group.x / MIN_GAP_PX)}:${Math.floor(group.y / MIN_GAP_PX)}`;
  }
}
