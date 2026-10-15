import { describe, expect, it } from "vitest";
import shops from "../data/shops.json";
import verified from "../data/verified.json";
import { ALL_PREFECTURES } from "../src/utils/prefectures";

type Record = { [key: string]: unknown };
const records = verified as Record[];
const shopIds = new Set(shops.map((s) => s.id));
const OSM_ID = /^(?:node|way|relation)\/\d+$/;
const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;

describe("確かめた記録（data/verified.json）", () => {
  it.each(records.map((r, i) => [i, r] as const))("%i: 形が決まりどおり", (_, r) => {
    expect(["self", "chain"]).toContain(r.basis);
    if (r.basis === "chain") expect(text(r.chain)).toBe(true);
    expect(["open", "closed", "unlisted"]).toContain(r.status);
    expect(r.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(r.checked as string).toISOString().slice(0, 10)).toBe(r.checked);
    expect(["official-site", "official-sns", "chain-list", "owner-visit"]).toContain(r.source);
    if (r.source !== "owner-visit") expect(String(r.url)).toMatch(/^https?:\/\//);
    if ("id" in r) {
      // 今のデータの店。店名・座標は OSM 側にあるので写さない（ODbL の集合データベースとして分けておく）。
      expect(shopIds.has(r.id as string)).toBe(true);
      for (const k of ["name", "prefecture", "address", "osmId", "lat", "lon"])
        expect(r).not.toHaveProperty(k);
    } else {
      // 今のデータに無い店。店名と場所は公式の情報から持つ。
      expect(text(r.name)).toBe(true);
      expect(ALL_PREFECTURES).toContain(r.prefecture);
      expect(text(r.address)).toBe(true);
      if ("osmId" in r) expect(r.osmId).toMatch(OSM_ID);
    }
  });

  it("同じ店を 2 回記録しない", () => {
    const keys = records.map((r) => (r.id as string) ?? `${r.prefecture}${r.address}`);
    expect(keys.length - new Set(keys).size).toBe(0);
  });
});
