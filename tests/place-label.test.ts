import { describe, expect, it } from "vitest";
import { localizeOrigin, nearbyPlaceLabel } from "../src/lib/place-label";

// 横浜駅のそばの 1 軒と、さいたま市の 1 軒。
const shops = [
  { lat: 35.4658, lon: 139.6223, prefecture: "神奈川県", city: "横浜市" },
  { lat: 35.8617, lon: 139.6455, prefecture: "埼玉県", city: "さいたま市" },
];

describe("nearbyPlaceLabel（#150）", () => {
  it("近い店が 20km 以内なら、その市区町村で呼ぶ", () => {
    expect(nearbyPlaceLabel(35.47, 139.63, shops)).toBe("横浜市付近");
  });

  it("20km を超えて 80km 以内なら、都道府県で呼ぶ", () => {
    // 熊谷あたり（さいたま市から約 40km）。
    expect(nearbyPlaceLabel(36.147, 139.388, shops)).toBe("埼玉県付近");
  });

  it("近い店が 80km より遠い（国外など）なら、ローマ字も地名も出さない", () => {
    expect(nearbyPlaceLabel(21.3069, -157.8583, shops)).toBe("現在地付近");
    expect(nearbyPlaceLabel(35.47, 139.63, [])).toBe("現在地付近");
  });
});

describe("localizeOrigin（#150）", () => {
  it("接続元の推定とホストの位置は、ローマ字の名前を日本語に置き換える", () => {
    const edge = { lat: 35.86, lon: 139.64, label: "Saitama Saitama", source: "edge" as const };
    expect(localizeOrigin(edge, shops).label).toBe("さいたま市付近");
    const host = { lat: 35.47, lon: 139.63, label: "Yokohama Kanagawa", source: "host" as const };
    expect(localizeOrigin(host, shops).label).toBe("横浜市付近");
  });

  it("端末の位置と地名は、利用者が分かる名前のまま変えない", () => {
    const precise = { lat: 35.47, lon: 139.63, label: "現在地", source: "precise" as const };
    const place = { lat: 35.47, lon: 139.63, label: "横浜駅", source: "place" as const };
    expect(localizeOrigin(precise, shops)).toBe(precise);
    expect(localizeOrigin(place, shops)).toBe(place);
  });
});
