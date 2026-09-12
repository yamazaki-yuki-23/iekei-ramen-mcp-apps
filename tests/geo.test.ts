import { describe, expect, it } from "vitest";
import { distanceKm, formatDistance } from "../src/lib/geo";

// 横浜駅と吉村家（実際に徒歩圏内）。距離計算の目安として使う。
const YOKOHAMA_STATION = { lat: 35.4658, lon: 139.6222 };
const YOSHIMURAYA = { lat: 35.463032, lon: 139.615069 };

describe("distanceKm", () => {
  it("同じ地点なら 0 を返す", () => {
    expect(distanceKm(35.4658, 139.6222, 35.4658, 139.6222)).toBe(0);
  });

  it("横浜駅から吉村家までを徒歩圏の距離として計算する", () => {
    const d = distanceKm(
      YOKOHAMA_STATION.lat,
      YOKOHAMA_STATION.lon,
      YOSHIMURAYA.lat,
      YOSHIMURAYA.lon,
    );
    expect(d).toBeGreaterThan(0.6);
    expect(d).toBeLessThan(0.9);
  });

  it("東京と大阪の距離をおよそ 400km とする", () => {
    const d = distanceKm(35.6812, 139.7671, 34.7025, 135.4959);
    expect(d).toBeGreaterThan(390);
    expect(d).toBeLessThan(420);
  });

  it("引数の順序を入れ替えても同じ距離になる", () => {
    const ab = distanceKm(35.0, 139.0, 36.0, 140.0);
    const ba = distanceKm(36.0, 140.0, 35.0, 139.0);
    expect(ab).toBeCloseTo(ba, 10);
  });

  it("赤道をまたいでも南半球の座標を扱える", () => {
    expect(distanceKm(1, 0, -1, 0)).toBeCloseTo(222.4, 0);
  });
});

describe("formatDistance", () => {
  it("1km 未満はメートル表記にする", () => {
    expect(formatDistance(0.261)).toBe("261m");
    expect(formatDistance(0.9994)).toBe("999m");
  });

  it("1km 以上は小数第 1 位までのキロ表記にする", () => {
    expect(formatDistance(1)).toBe("1.0km");
    expect(formatDistance(12.34)).toBe("12.3km");
  });

  it("0 を 0m として扱う", () => {
    expect(formatDistance(0)).toBe("0m");
  });
});
