import { describe, expect, it } from "vitest";
import { summarize } from "../src/lib/progress";
import type { Shop } from "../src/lib/types";

function shop(id: string, prefecture: string): Shop {
  return {
    id,
    name: id,
    taste: "unknown",
    confidence: "confirmed",
    prefecture,
    lat: 35,
    lon: 139,
    osmUrl: `https://www.openstreetmap.org/${id}`,
  };
}

const SHOPS = [
  shop("k1", "神奈川県"),
  shop("k2", "神奈川県"),
  shop("k3", "神奈川県"),
  shop("t1", "東京都"),
  shop("t2", "東京都"),
];

describe("summarize", () => {
  it("行った数・全体・割合を出す", () => {
    expect(summarize(SHOPS, ["k1", "t1"]).overall).toEqual({
      visited: 2,
      total: 5,
      percent: 40,
    });
  });

  it("1 軒も行っていなければ 0%", () => {
    expect(summarize(SHOPS, []).overall).toEqual({ visited: 0, total: 5, percent: 0 });
  });

  it("県ごとに分ける。**行っていない県は並べない**", () => {
    // 47 行の 0 を見せても読む気を削ぐだけ。
    const { prefectures } = summarize(SHOPS, ["k1", "k2"]);

    expect(prefectures).toEqual([{ prefecture: "神奈川県", visited: 2, total: 3, percent: 66.7 }]);
  });

  it("行った数の多い順に並ぶ", () => {
    const { prefectures } = summarize(SHOPS, ["k1", "k2", "t1"]);

    expect(prefectures.map((p) => p.prefecture)).toEqual(["神奈川県", "東京都"]);
  });

  it("同数なら県名で並び、何度呼んでも同じ順になる", () => {
    // 並びがぶれると、画面を開くたびに順番が変わって読めなくなる。
    const once = summarize(SHOPS, ["k1", "t1"]).prefectures.map((p) => p.prefecture);

    expect(once).toEqual(["東京都", "神奈川県"]);
    expect(summarize(SHOPS, ["t1", "k1"]).prefectures.map((p) => p.prefecture)).toEqual(once);
  });

  it("店舗データにもう無い ID は数えない", () => {
    /*
     * データを取り直すと店が消えることがある。数えてしまうと
     * 「行った数 > 全体の数」という、あり得ない表示になる。
     */
    const { overall } = summarize(SHOPS, ["k1", "消えた店"]);

    expect(overall).toEqual({ visited: 1, total: 5, percent: 20 });
  });

  it("割合は小数第 1 位まで", () => {
    expect(summarize(SHOPS, ["k1"]).overall.percent).toBe(20);
    expect(summarize(SHOPS, ["k1", "k2"]).overall.percent).toBe(40);
    expect(summarize([...SHOPS, shop("x", "千葉県")], ["k1"]).overall.percent).toBe(16.7);
  });
});
