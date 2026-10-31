import { describe, expect, it } from "vitest";
import type { Shop } from "../../src/types/index.ts";
import { townOf, withSameNamePlace } from "./same-name-place";

const shop = (id: string, name: string, city?: string, address?: string): Shop => ({
  id,
  name,
  city,
  address,
  prefecture: "神奈川県",
  taste: "unknown",
  confidence: "confirmed",
  lat: 0,
  lon: 0,
});

describe("townOf（#307）", () => {
  it("区・郡と、丁目・番地を外して町名だけにする", () => {
    expect(townOf("守山区苗代一丁目14-4")).toBe("苗代");
    expect(townOf("一番町3丁目11-14 1F")).toBe("一番町");
    expect(townOf("城の里")).toBe("城の里");
    expect(townOf("南中丸")).toBe("南中丸");
    // 札幌の条は町名の一部（Codex の指摘、PR #310）。
    expect(townOf("北15条西4")).toBe("北15条");
  });

  it("番地だけ・住所無しからは何も取らない", () => {
    expect(townOf("3-11")).toBeUndefined();
    expect(townOf("１丁目１－３１")).toBeUndefined();
    expect(townOf(undefined)).toBeUndefined();
  });
});

describe("withSameNamePlace（#307）", () => {
  it("同じ店名の店にだけ町名を付け、町名が重なれば市区町村、どちらも無理なら付けない", () => {
    const shops = withSameNamePlace([
      shop("1", "町田商店", "さいたま市", "南中丸"),
      shop("2", "町田商店", "小田原市", "栄町二丁目"),
      shop("3", "町田商店", "鹿沼市", "栄町一丁目"),
      shop("4", "町田商店", "さいたま市", "3-11"),
      shop("5", "吉村家", "横浜市", "南幸二丁目"),
    ]);
    expect(shops.map((s) => s.place)).toEqual([
      "南中丸",
      "小田原市",
      "鹿沼市",
      undefined,
      undefined,
    ]);
  });
});
