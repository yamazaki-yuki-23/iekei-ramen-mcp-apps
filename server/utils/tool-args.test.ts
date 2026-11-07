import { describe, expect, it } from "vitest";
import type { Origin, Shop } from "../../src/types";
import { rankByKeyword } from "./tool-args";

const shop = (id: string, name: string, lat: number, extra: Partial<Shop> = {}) =>
  ({ id, name, lat, lon: 139.6, prefecture: "神奈川県", ...extra }) as Shop;
// 元の順は「系列の一致（遠い）→ 部分一致 → 完全一致」。並べ替えが効かなければこの順のまま。
const shops = [
  shop("far-chain", "高松家", 34.3, { brand: "吉村家" }),
  shop("partial", "吉村家 新店", 35.0),
  shop("exact", "吉村家", 35.46),
  shop("near-chain", "厚木家", 35.44, { brand: "吉村家" }),
];
const yokohama: Origin = { lat: 35.4658, lon: 139.6, source: "edge" };

describe("rankByKeyword（#366）", () => {
  it("店名の完全一致 → 店名の部分一致 → 系列などの一致 の順にする", () => {
    expect(rankByKeyword(shops, "吉村家").map((s) => s.id)).toEqual([
      "exact",
      "partial",
      "far-chain",
      "near-chain",
    ]);
  });

  it("基準地点があれば、同じ段の中を近い順にする", () => {
    expect(rankByKeyword(shops, "吉村家", yokohama).map((s) => s.id)).toEqual([
      "exact",
      "partial",
      "near-chain",
      "far-chain",
    ]);
  });

  it("前後の空白と大文字小文字は区別しない（英字の店名）", () => {
    const en = [shop("a", "Yoshimuraya Annex", 35), shop("b", "Yoshimuraya", 35)];
    expect(rankByKeyword(en, "  yoshimuraya ").map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("元の配列は並べ替えない", () => {
    const before = shops.map((s) => s.id);
    rankByKeyword(shops, "吉村家", yokohama);
    expect(shops.map((s) => s.id)).toEqual(before);
  });
});
