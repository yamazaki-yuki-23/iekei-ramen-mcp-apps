/** 地図データの駅（pois の station）の 1 件。 */
export interface RawStation {
  name?: unknown;
  nameJa?: unknown;
  minZoom?: unknown;
  lon: number;
  lat: number;
}

/** 地図に出す駅の札。 */
export interface Station {
  n: string;
  mz: number;
  lon: number;
  lat: number;
}

/**
 * 駅をまとめる（#246）。同じ名前の駅（路線ごとに別の点）を約 700m 以内なら 1 つにし、名前の括弧
 * （「横浜 (相模鉄道)」）を外す。「東京」が 2 つ出るのを防ぐ。
 *
 * `key` は前と同じかを比べるためのもの。**名前だけで作らない**（同じ名前の駅が 1 つずつしか無い
 * 2 つの地域を行き来すると、古い位置のままになる）。位置と、出し始めるズームの段も入れる。
 */
export function mergeStations(raw: RawStation[]): { stations: Station[]; key: string } {
  const stations: Station[] = [];
  for (const r of raw) {
    const n = String(r.nameJa ?? r.name ?? "").replace(/\s*[（(].*[)）]\s*$/, "");
    if (!n) continue;
    const near = stations.some(
      (s) => s.n === n && Math.hypot((s.lon - r.lon) * 91, (s.lat - r.lat) * 111) < 0.7,
    );
    if (near) continue;
    stations.push({
      n,
      mz: typeof r.minZoom === "number" ? r.minZoom : 14,
      lon: r.lon,
      lat: r.lat,
    });
  }
  const key = stations
    .map((s) => `${s.n}@${s.lon.toFixed(5)},${s.lat.toFixed(5)}:${s.mz}`)
    .join("|");
  return { stations, key };
}
