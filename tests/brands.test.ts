import { describe, expect, it } from "vitest";
import { topBrands } from "../src/lib/brands";
import type { Shop } from "../src/lib/types";

const shop = (id: string, brand?: string): Shop => ({
  id,
  name: id,
  brand,
  taste: "unknown",
  confidence: "confirmed",
  prefecture: "神奈川県",
  lat: 35,
  lon: 139,
  osmUrl: "https://example.test",
});

describe("店名の券売機に並べるブランド", () => {
  it("判定した結果の軒数が多い順。同じ軒数なら名前の順で、ブランドの無い店は数えない", () => {
    const shops = [
      shop("a", "町田商店"),
      shop("b", "町田商店"),
      shop("c", "壱角家"),
      shop("d", "せい家"),
      shop("e"),
    ];
    expect(topBrands(shops)).toEqual([
      { name: "町田商店", count: 2 },
      { name: "せい家", count: 1 },
      { name: "壱角家", count: 1 },
    ]);
  });

  it("上から n 個で切る", () => {
    expect(topBrands([shop("a", "x"), shop("b", "y"), shop("c", "z")], 2)).toHaveLength(2);
  });
});
