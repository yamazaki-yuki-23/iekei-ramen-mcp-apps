import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error データ作成スクリプトはJavaScript。
import { officialCity, withOfficialCity } from "../scripts/data/municipalities.mjs";

const municipalities = JSON.parse(
  readFileSync(new URL("../data/municipalities.json", import.meta.url), "utf8"),
);
const shops: { id: string; prefecture: string; city?: string }[] = JSON.parse(
  readFileSync(new URL("../data/shops.json", import.meta.url), "utf8"),
);
const shop = { id: "node/1", name: "試験家", lat: 35, lon: 139 };

describe("市区町村の名前を総務省の一覧にそろえる（#349）", () => {
  it.each([
    // OSM の addr:city に実際に入っていた形
    ["山形県", "酒田市上安町", "１丁目１－３１", "酒田市", "上安町１丁目１－３１"],
    ["秋田県", "横手", "十文字町海道下23-1", "横手市", "十文字町海道下23-1"],
    ["神奈川県", "中区", "末吉町3丁目67-7", "横浜市", "中区末吉町3丁目67-7"],
    ["千葉県", "中央区", "祐光4丁目17-7", "千葉市", "中央区祐光4丁目17-7"],
    ["和歌山県", "和歌山県 御坊市湯川町財部70-8", "薗", "御坊市", "湯川町財部70-8 薗"],
    ["熊本県", "熊本市中央区", "神水１−６−３", "熊本市", "中央区神水１−６−３"],
  ])("%s「%s」は %s にし、残りを住所の頭に回す", (prefecture, city, address, want, wantAddress) => {
    expect(withOfficialCity(municipalities, { ...shop, prefecture, city, address })).toMatchObject({
      city: want,
      address: wantAddress,
    });
  });

  it("一覧どおりの名前と、東京の特別区はそのまま", () => {
    const named = { ...shop, prefecture: "愛知県", city: "名古屋市", address: "中区栄1-1" };
    expect(withOfficialCity(municipalities, named)).toBe(named);
    expect(officialCity(municipalities, "東京都", "中央区")).toEqual({ city: "中央区", rest: "" });
  });

  it("当てられない名前と、同じ県に 2 つある区だけの名前は決めない", () => {
    expect(
      withOfficialCity(municipalities, { ...shop, prefecture: "神奈川県", city: "架空市" }),
    ).toBeUndefined();
    // 横浜市緑区と相模原市緑区
    expect(officialCity(municipalities, "神奈川県", "緑区")).toBeUndefined();
  });

  it("今の shops.json の市区町村は、すべて一覧の名前（政令市は市）", () => {
    const off = shops.filter(
      (s) => s.city && officialCity(municipalities, s.prefecture, s.city)?.city !== s.city,
    );
    expect(off.map((s) => `${s.prefecture}${s.city} ${s.id}`)).toEqual([]);
  });
});
