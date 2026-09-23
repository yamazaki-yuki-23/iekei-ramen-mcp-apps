import type { Origin } from "./types";

const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** 2 地点間の直線距離 (km)。Haversine。 */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}

/**
 * 基準地点の呼び名。
 *
 * 名前が無いときは座標で示す。「全国」などに落とすと、距離で並べた結果なのに
 * 場所を指していない見出しになり、何を基準にした並びなのか分からなくなる。
 */
export function originLabel(origin: Origin): string {
  // 空白だけの表示名は無いものとして扱う。そのまま出すと「（）」や
  // 「から近い順」のように、場所の抜けた文言になる。
  return origin.label?.trim() || `${origin.lat.toFixed(4)}, ${origin.lon.toFixed(4)}`;
}
