import { describe, expect, it } from "vitest";
import shopsData from "../data/shops.json" with { type: "json" };
import { clusterShops } from "../src/lib/cluster";
import type { Shop } from "../src/lib/types";

const ALL_SHOPS = shopsData as unknown as Shop[];

/** 塊の印の大きさ。これより近い代表点どうしは重なって読めない。 */
const MARKER_PX = 36;
const TILE_PX = 256;

/** 画面上の位置。cluster.ts と同じ Web メルカトル。 */
function project(lat: number, lon: number, zoom: number) {
  const scale = TILE_PX * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/** いちばん近い代表点どうしの距離（px）。 */
function closestGap(shops: Shop[], zoom: number): number {
  const points = clusterShops(shops, zoom).map((c) => project(c.lat, c.lon, zoom));
  let closest = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      closest = Math.min(closest, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    }
  }
  return closest;
}

/** 横浜駅あたり。 */
const BASE = { lat: 35.4657, lon: 139.622 };

/** 指定した m だけ東へずらした店。塊の境目を作るために使う。 */
function shopAt(id: string, metersEast: number): Shop {
  // この緯度では経度 1 度がおよそ 90.6km。
  return {
    id,
    name: id,
    taste: "unknown",
    confidence: "confirmed",
    prefecture: "神奈川県",
    lat: BASE.lat,
    lon: BASE.lon + metersEast / 90_600,
    osmUrl: `https://www.openstreetmap.org/${id}`,
  };
}

describe("clusterShops", () => {
  it("近すぎて重なる店は 1 つの塊にまとめる", () => {
    // ズーム 10 では 1px がおよそ 120m。50m 差は同じ升目に入る。
    const clusters = clusterShops([shopAt("a", 0), shopAt("b", 50)], 10);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].shops.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("寄れば塊が解ける（同じ店でもズームで変わる）", () => {
    const shops = [shopAt("a", 0), shopAt("b", 300)];

    expect(clusterShops(shops, 10)).toHaveLength(1);
    expect(clusterShops(shops, 16)).toHaveLength(2);
  });

  it("代表点は集まった店の平均で、実在の店の位置とは限らない", () => {
    const [cluster] = clusterShops([shopAt("a", 0), shopAt("b", 50)], 10);

    expect(cluster.lon).toBeCloseTo((shopAt("a", 0).lon + shopAt("b", 50).lon) / 2, 10);
    expect(cluster.lat).toBeCloseTo(BASE.lat, 10);
  });

  it("選択中の店は、塊に飲ませず単独で返す", () => {
    // 選んだ店が塊の中に消えると、地図のどこを選んだのか分からなくなる。
    const clusters = clusterShops([shopAt("a", 0), shopAt("b", 50)], 10, "b");

    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.shops.map((s) => s.id))).toEqual([["a"], ["b"]]);
  });

  it("同じ入力なら毎回同じ並びで返る", () => {
    const shops = [shopAt("a", 0), shopAt("b", 5_000), shopAt("c", 50)];
    const once = clusterShops(shops, 10).map((c) => c.shops.map((s) => s.id));

    expect(clusterShops(shops, 10).map((c) => c.shops.map((s) => s.id))).toEqual(once);
    expect(once).toEqual([["a", "c"], ["b"]]);
  });

  it("空の一覧は空で返す", () => {
    expect(clusterShops([], 10)).toEqual([]);
  });

  it("升目の境目を挟んでいても、近すぎる店はまとめる", () => {
    /*
     * 升目の識別だけで切っていた頃は、境目を挟んだ数 px の 2 軒が別々の塊に
     * なっていた。印は重なって読めないのに、まとまってもいない状態になる。
     *
     * **偶然に頼らず、境目にまたがる組を作って確かめる。** 適当な座標だと
     * 同じ升目に収まってしまい、直っていなくても通ってしまう。
     */
    const zoom = 12;
    const scale = TILE_PX * 2 ** zoom;
    // x が升目の倍数になる経度＝境目。その 2px 手前と 2px 先に 1 軒ずつ置く。
    const edgeX = Math.round(scale / 2 / 64) * 64;
    const lonAt = (x: number) => (x / scale) * 360 - 180;
    const straddling = [
      { ...shopAt("west", 0), lon: lonAt(edgeX - 2) },
      { ...shopAt("east", 0), lon: lonAt(edgeX + 2) },
    ];

    const clusters = clusterShops(straddling, zoom);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].shops.map((s) => s.id)).toEqual(["west", "east"]);
  });

  it("実データのどのズームでも、塊の印どうしが重ならない", () => {
    /*
     * 直した前の実測: zoom 5 で 5 組が重なり、最接近は 9.9px だった。
     * 升目をまたいだ寄せ直しが効いていれば、どのズームでも 36px 以上あく。
     */
    for (const zoom of [5, 8, 10, 12]) {
      expect(closestGap(ALL_SHOPS, zoom)).toBeGreaterThanOrEqual(MARKER_PX);
    }
  });

  it("寄っても解けない塊が実在する（一覧への逃げ道が要る理由）", () => {
    /*
     * ろくの家と稲和家ラーメンは 5.2m しか離れていない。地図の最大ズーム 19
     * でも 21.1px で、まとめる下限 36px を下回ったまま＝どれだけ寄せても
     * 1 つの塊のまま。**寄せるだけの逃げ道しか無いと、この 2 軒は地図から
     * 永久に選べない。** 押した塊の中身を一覧に出す実装は、ここが根拠。
     */
    const pair = ["ろくの家", "稲和家"].map((name) =>
      ALL_SHOPS.find((s) => s.name.includes(name))!,
    );

    expect(pair.every(Boolean)).toBe(true);
    // 19 は地図の maxZoom。それでもまとまったまま。
    expect(clusterShops(pair, 19)).toHaveLength(1);
  });

  it("まとめても店は落とさない", () => {
    // 寄せ直しで取りこぼすと、地図から店が消えたまま誰も気付けない。
    const counted = clusterShops(ALL_SHOPS, 10).reduce((n, c) => n + c.shops.length, 0);
    expect(counted).toBe(ALL_SHOPS.length);
  });
});
