import { describe, expect, it } from "vitest";
import { mergeStations } from "./stations";

describe("駅の札をまとめる（#246）", () => {
  it("同じ名前の駅は 700m 以内なら 1 つにし、括弧を外す", () => {
    const { stations } = mergeStations([
      { nameJa: "横浜 (相模鉄道)", lon: 139.622, lat: 35.4658 },
      { nameJa: "横浜", lon: 139.6225, lat: 35.466 },
      { nameJa: "横浜", lon: 139.7, lat: 35.5 }, // 遠い同名は別
    ]);
    expect(stations.map((s) => s.n)).toEqual(["横浜", "横浜"]);
  });

  it("名前の並びが同じでも、位置が違えば別の鍵になる（古い位置のままにしない）", () => {
    const a = mergeStations([{ nameJa: "本町", lon: 140.1, lat: 36.1, minZoom: 13 }]);
    const b = mergeStations([{ nameJa: "本町", lon: 141.2, lat: 38.2, minZoom: 13 }]);
    expect(a.key).not.toBe(b.key);
  });

  it("出し始めるズームの段が違えば別の鍵になる", () => {
    const a = mergeStations([{ nameJa: "本町", lon: 140.1, lat: 36.1, minZoom: 13 }]);
    const b = mergeStations([{ nameJa: "本町", lon: 140.1, lat: 36.1, minZoom: 15 }]);
    expect(a.key).not.toBe(b.key);
  });
});
