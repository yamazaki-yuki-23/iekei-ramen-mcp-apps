import { describe, expect, it } from "vitest";
import { brandCounts, factStamp, shopFacts } from "../src/lib/shop-facts";
import type { Shop } from "../src/lib/types";

const shop = (over: Partial<Shop>): Shop => ({
  id: "node/1",
  name: "試験家",
  taste: "unknown",
  confidence: "confirmed",
  prefecture: "神奈川県",
  city: "横浜市",
  lat: 35.46,
  lon: 139.62,
  osmUrl: "https://www.openstreetmap.org/node/1",
  ...over,
});

describe("shopFacts（#166 のレア札の理由）", () => {
  it("事実が無ければ空。並びを変えるものは返さない", () => {
    expect(shopFacts(shop({}), new Map())).toEqual([]);
  });

  it("味の傾向が直系・濃厚なら、その参考値の名前を返す", () => {
    expect(shopFacts(shop({ taste: "rich" }), new Map())).toEqual(["直系・濃厚"]);
  });

  it("営業時間の記載から、24 時間・朝 5 時までの開店を拾う（6 時は拾わない）", () => {
    expect(shopFacts(shop({ openingHours: "24/7" }), new Map())).toEqual(["24 時間営業の記載"]);
    expect(shopFacts(shop({ openingHours: "Mo-Su 05:00-24:00" }), new Map())).toEqual([
      "朝 5 時から",
    ]);
    expect(shopFacts(shop({ openingHours: "06:00-15:00" }), new Map())).toEqual([]);
    // 0 時に始まる区間は前の晩の続き。朝に開けているとは言わない（実データの書き方）。
    expect(
      shopFacts(
        shop({ openingHours: "Mo-Sa 11:00-03:00; Su,PH 00:00-03:00,11:00-23:00" }),
        new Map(),
      ),
    ).toEqual([]);
    expect(shopFacts(shop({ openingHours: "00:00-03:00,10:30-24:00" }), new Map())).toEqual([]);
  });

  it("その市区町村で 1 軒だけのブランドを拾う（2 軒あれば拾わない）", () => {
    const one = shop({ brand: "吉村家" });
    const counts = brandCounts([one, shop({ brand: "町田商店" }), shop({ brand: "町田商店" })]);
    expect(shopFacts(one, counts)).toEqual(["横浜市で 1 軒だけの吉村家"]);
    expect(shopFacts(shop({ brand: "町田商店" }), counts)).toEqual([]);
  });

  it("判子は一目で読める長さにする（札には理由を全部書く）", () => {
    expect(
      ["直系・濃厚", "24 時間営業の記載", "朝 5 時から", "横浜市で 1 軒だけの吉村家"].map(
        factStamp,
      ),
    ).toEqual(["直系・濃厚", "24 時間", "朝 5 時から", "1 軒だけ"]);
  });

  it("おいしさ・人気・営業中を示す言葉を使わない", () => {
    const all = shopFacts(
      shop({ taste: "rich", openingHours: "24/7", brand: "吉村家" }),
      brandCounts([shop({ brand: "吉村家" })]),
    );
    for (const word of ["人気", "おいしい", "営業中", "当たり"])
      expect(all.join("")).not.toContain(word);
  });
});
