import { describe, expect, it } from "vitest";
import { clusterShops } from "../src/lib/cluster";
import type { Shop } from "../src/lib/types";

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
});
