/**
 * 同名の店の見分け。
 *
 * **重複登録ではなく、チェーンの別店舗**が同じ文字列で並ぶのが問題。
 * 実データでは東京都に町田商店が 14 店ある。
 */
import { describe, expect, it } from "vitest";
import { sameNameLabels } from "../src/lib/same-name";
import type { Shop } from "../src/lib/types";

const shop = (id: string, name: string, city?: string, address?: string): Shop =>
  ({ id, name, city, address, prefecture: "東京都" }) as Shop;

describe("sameNameLabels", () => {
  it("名前が重ならなければ何も出さない", () => {
    const labels = sameNameLabels([shop("1", "壱八家", "横浜市"), shop("2", "武蔵家", "新宿区")]);
    expect(labels.size).toBe(0);
  });

  it("同名なら市区町村で見分ける", () => {
    const labels = sameNameLabels([
      shop("1", "町田商店", "新宿区"),
      shop("2", "町田商店", "町田市"),
    ]);
    expect(labels.get("1")).toBe("新宿区");
    expect(labels.get("2")).toBe("町田市");
  });

  it("同じ市に 2 店あるときは町名まで降りる", () => {
    // 町田市の町田商店は実在する（矢部町 / 森野一丁目）。
    const labels = sameNameLabels([
      shop("1", "町田商店", "町田市", "矢部町"),
      shop("2", "町田商店", "町田市", "森野一丁目"),
    ]);
    expect(labels.get("1")).toBe("町田市 矢部町");
    expect(labels.get("2")).toBe("町田市 森野一丁目");
  });

  it("出すものが無ければ黙っている（空の括弧を作らない）", () => {
    const labels = sameNameLabels([shop("1", "町田商店"), shop("2", "町田商店")]);
    expect(labels.size).toBe(0);
  });
});
