import { describe, expect, it } from "vitest";
import shops from "../data/shops.json";
import verified from "../data/verified.json";
import verifiedGeo from "../data/verified-geo.json";
import { paced } from "../scripts/data/geocode-verified.mjs";
import {
  isPrecise,
  maybeSameShop,
  nearbyShops,
  splitCity,
  verifiedShops,
} from "../scripts/data/verified-shops.mjs";

const record = {
  name: "横浜家系ラーメン 町田商店 盛岡津志田店",
  prefecture: "岩手県",
  address: "盛岡市津志田南1-1-16",
  basis: "chain",
  chain: "町田商店",
  status: "open",
};
const geo = {
  "岩手県盛岡市津志田南1-1-16": {
    precise: true,
    title: "岩手県盛岡市津志田南一丁目１番",
    lat: 39.659058,
    lon: 141.160797,
    city: "盛岡市",
  },
};

describe("番地の精度で当たったか（国土地理院の住所検索）", () => {
  it.each([
    ["岩手県盛岡市津志田南一丁目１番", "盛岡市津志田南1-1-16", true],
    ["岩手県奥州市水沢佐倉河川原田１０９番地", "奥州市水沢佐倉河川原田109-2", true],
    ["岩手県盛岡市大通二丁目１番３号", "盛岡市大通2-1-3 第2ビル 1F", true],
    ["岩手県八幡平市二十三丁目４番", "八幡平市23丁目4", true],
    // 丁目の数字が街区の番号と同じだけで、街区は違う（1-20-5 に「一丁目１番」）
    ["岩手県盛岡市大通一丁目１番", "盛岡市大通1-20-5", false],
    // 建物の名前の数字にだけある
    ["岩手県盛岡市大通一丁目２番", "盛岡市大通1-20-5 第2ビル", false],
    ["岩手県盛岡市大通２番地", "盛岡市大通15 第2ビル", false],
    // 手前の番号にしか当たっていない（6, 1 が残る）
    ["岩手県盛岡市大島田１番地", "盛岡市大島田1-6-1", false],
    // 建物名の数字（第1）は番地の続きにしない
    ["岩手県盛岡市羽田三丁目３番", "盛岡市羽田3-3-2 第1旅客ターミナルビル3F", true],
    // 同じ県の別の町に、同じ数字の並びで当たった
    ["岩手県盛岡市別町一丁目２０番", "盛岡市大通1-20-5", false],
    // 空白の後の建物名の漢数字を、番地につなげない（7 と 八 → 78 にしない）
    ["岩手県盛岡市山王二丁目２番７号", "盛岡市山王2-2-7 八景坂ビル1階", true],
    // 町名の途中の空白・ヶとケの違いは同じ町
    ["岩手県盛岡市緑区中尾３０３番地", "盛岡市緑区 中尾303-1", true],
    ["岩手県茅ヶ崎市元町３番１０号", "茅ケ崎市元町3-10", true],
    // 字までしか当たらなかった
    ["岩手県一関市山目泥田", "一関市山目字泥田61-1", false],
    // 別の番地に当たった
    ["岩手県奥州市水沢佐倉河川原田１１０番地", "奥州市水沢佐倉河川原田109-2", false],
    // 別の県に当たった
    ["宮城県仙台市青葉区一番町一丁目１番", "盛岡市津志田南1-1-16", false],
  ])("%s ← %s", (title, address, expected) => {
    expect(isPrecise(title, { prefecture: "岩手県", address })).toBe(expected);
  });
});

describe("市区町村と残りの住所", () => {
  it.each([
    ["盛岡市津志田南1-1-16", "盛岡市", "盛岡市", "津志田南1-1-16"],
    ["本巣郡 北方町高屋1327", "北方町", "北方町", "高屋1327"],
    ["茅ケ崎市元町3-10", "茅ヶ崎市", "茅ヶ崎市", "元町3-10"],
    // 座標から引いた市区町村が公式の住所と合わない（境の近く）なら、公式の住所の頭から取る
    ["練馬区旭町3-35-6", "板橋区", "練馬区", "旭町3-35-6"],
    ["豊明市前後町三ツ谷1312-1", "名古屋市", "豊明市", "前後町三ツ谷1312-1"],
    ["町田市常盤町3198-1", undefined, "町田市", "常盤町3198-1"],
    // 座標から郡しか返らない・何も返らないときも、郡の後の町村を取る
    ["本巣郡 北方町高屋1327", "本巣郡", "北方町", "高屋1327"],
    ["本巣郡北方町高屋1327", undefined, "北方町", "高屋1327"],
  ])("%s（座標から %s）→ %s / %s", (address, reversed, city, rest) => {
    expect(splitCity(address, reversed)).toEqual({ city, address: rest });
  });
});

describe("確かめた記録から足す店", () => {
  it("記録に無いことは埋めない", () => {
    const [shop] = verifiedShops([record], geo);
    expect(shop).toEqual({
      id: expect.stringMatching(/^verified\/[0-9a-f]{20}$/),
      name: record.name,
      brand: "町田商店",
      taste: "unknown",
      confidence: "confirmed",
      prefecture: "岩手県",
      city: "盛岡市",
      address: "津志田南1-1-16",
      lat: 39.659058,
      lon: 141.160797,
    });
  });

  it("座標を引いていない記録があれば、黙って飛ばさずに止める", () => {
    expect(() => verifiedShops([{ ...record, address: "北上市町分2地割522-1" }], geo)).toThrow(
      /data:geocode/,
    );
  });

  it("番地の精度で当たらなかった店・営業中でない店・今のデータにある店は足さない", () => {
    const g = {
      ...geo,
      "岩手県一関市山目字泥田61-1": { precise: false, title: "岩手県一関市山目泥田" },
    };
    const others = [
      { ...record, address: "一関市山目字泥田61-1" },
      { ...record, status: "closed" },
      { id: "node/1", basis: "chain", chain: "町田商店", status: "open" },
    ];
    expect(verifiedShops(others, g)).toEqual([]);
  });

  it("100m 以内の今の店を、系列を問わずに挙げる", () => {
    const [shop] = verifiedShops([record], geo);
    const near = { ...shop, id: "node/1", name: "町田商店 盛岡店", brand: undefined, lat: 39.6596 };
    const far = { ...near, id: "node/2", lat: 39.661 };
    const other = { ...near, id: "node/3", name: "横浜家系ラーメン" };
    expect(nearbyShops([shop], [near, far, other]).map((x) => x.existing.id)).toEqual([
      "node/1",
      "node/3",
    ]);
  });

  it.each([
    ["町田商店 盛岡店", "node/1", true], // 同じ系列で公式の一覧に無い
    ["町田商店 盛岡店", "node/9", false], // 同じ系列で公式の一覧にある（別の店）
    ["横浜家系ラーメン", "node/9", true], // 一般名だけで、どの店か分からない
    ["横浜家系 らーめん", "node/9", true],
    ["道玄家", "node/9", false], // 店名を持つ別の店
  ])("近くの「%s」(%s) は同じ店かもしれない: %s", (name, id, expected) => {
    const [shop] = verifiedShops([record], geo);
    expect(maybeSameShop(shop, { ...shop, id, name, brand: undefined }, new Set(["node/1"]))).toBe(
      expected,
    );
  });

  it("今のデータ（shops.json）の verified/ の店は、確かめた記録から作れて、ID が重ならない", () => {
    const made = new Set(verifiedShops(verified, verifiedGeo).map((s) => s.id));
    const added = shops.filter((s) => s.id.startsWith("verified/"));
    expect(added.length).toBeGreaterThan(0);
    expect(added.filter((s) => !made.has(s.id))).toEqual([]);
    expect(new Set(shops.map((s) => s.id)).size).toBe(shops.length);
  });
});

describe("系列を持たない記録（basis: self）", () => {
  it("ブランドの無い近くの今の店を、同じ系列と見ない", () => {
    const [shop] = verifiedShops([record], geo);
    const self = { ...shop, brand: undefined };
    const existing = { ...shop, id: "node/1", name: "道玄家", brand: undefined };
    expect(maybeSameShop(self, existing, new Set(["node/1"]))).toBe(false);
  });
});

describe("問い合わせの間隔", () => {
  it("失敗したときも待ってから次へ進む（連打にしない）", async () => {
    const waits: string[] = [];
    const wait = async () => {
      waits.push("wait");
    };
    await expect(paced(() => Promise.reject(new Error("HTTP 429")), wait)).rejects.toThrow("429");
    await expect(paced(async () => "ok", wait)).resolves.toBe("ok");
    expect(waits).toEqual(["wait", "wait"]);
  });
});
