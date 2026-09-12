import { describe, expect, it } from "vitest";
// @ts-expect-error データ生成スクリプトと共有する素の JS モジュール
import { buildAddress, classify, toShop } from "../scripts/classify.mjs";

/** OSM のタグを組み立てる小さなヘルパ。 */
const tags = (t: Record<string, string>) => t;

describe("classify — 家系確定", () => {
  it("店名に「家系」を含めば確定にする", () => {
    expect(classify(tags({ name: "横浜家系ラーメン 独覚家" }))).toBe("confirmed");
  });

  it("cuisine が無くても「家系」があれば確定にする", () => {
    expect(classify(tags({ name: "家系ラーメン 磯子家" }))).toBe("confirmed");
  });

  it("既知ブランドは確定にする", () => {
    expect(classify(tags({ name: "吉村家", cuisine: "ramen" }))).toBe("confirmed");
    expect(classify(tags({ name: "町田商店 環七環八店" }))).toBe("confirmed");
  });

  it("brand タグ側に既知ブランドがあっても確定にする", () => {
    expect(classify(tags({ name: "ラーメン", brand: "壱角家" }))).toBe("confirmed");
  });
});

describe("classify — 家系の可能性", () => {
  it("ラーメン店で店名が「家」で終われば likely にする", () => {
    expect(classify(tags({ name: "ありがた家", cuisine: "ramen" }))).toBe("likely");
  });

  it("支店名が付いていても核の部分で判定する", () => {
    expect(classify(tags({ name: "えびす家 本店", cuisine: "ramen" }))).toBe("likely");
    expect(classify(tags({ name: "たから家 川崎店", cuisine: "ramen" }))).toBe("likely");
  });

  it("括弧書きの英名が付いていても判定できる", () => {
    expect(classify(tags({ name: "なごみ家 (Nagomiya)", cuisine: "ramen" }))).toBe("likely");
  });
});

describe("classify — 除外", () => {
  it("ラーメン店でなければ「家」で終わっても除外する", () => {
    expect(classify(tags({ name: "大黒家", cuisine: "sushi" }))).toBeNull();
    expect(classify(tags({ name: "たから家" }))).toBeNull();
  });

  it("他ジャンルの語を含む店は likely にしない", () => {
    expect(classify(tags({ name: "そば家 なかもと", cuisine: "ramen" }))).toBeNull();
    expect(classify(tags({ name: "タンタンメン金家", cuisine: "ramen" }))).toBeNull();
    expect(classify(tags({ name: "にぼし家", cuisine: "ramen" }))).toBeNull();
  });

  it("家系ではない既知の店を除外リストで落とす", () => {
    expect(classify(tags({ name: "本家第一旭", cuisine: "ramen" }))).toBeNull();
    expect(classify(tags({ name: "無敵家", cuisine: "ramen" }))).toBeNull();
  });

  it("飲食店ですらないものを落とす（杉田家住宅は文化財）", () => {
    expect(classify(tags({ name: "杉田家住宅" }))).toBeNull();
  });

  it("名前が無い要素は null を返す", () => {
    expect(classify(tags({ cuisine: "ramen" }))).toBeNull();
  });

  it("除外リストはジャンル語より強く、確定判定より先に効く", () => {
    // 「〜家」を含むが家系ではないチェーン
    expect(
      classify(tags({ name: "ラーメン山岡家", cuisine: "ramen", brand: "幸楽苑" })),
    ).toBeNull();
  });
});

describe("buildAddress", () => {
  it("suburb に含まれる市名を取り除いて重複を防ぐ", () => {
    expect(
      buildAddress(
        tags({
          "addr:city": "横浜市",
          "addr:suburb": "横浜市西区",
          "addr:quarter": "岡野",
          "addr:block_number": "1丁目64",
        }),
      ),
    ).toEqual({ city: "横浜市", address: "西区岡野1丁目64" });
  });

  it("city が無くても住所を組み立てる", () => {
    expect(
      buildAddress(tags({ "addr:neighbourhood": "平沼", "addr:block_number": "1-6-14" })),
    ).toEqual({ city: undefined, address: "平沼1-6-14" });
  });

  it("住所タグが無ければ undefined を返す", () => {
    expect(buildAddress(tags({}))).toEqual({ city: undefined, address: undefined });
  });
});

describe("toShop", () => {
  const element = {
    osmType: "node",
    osmId: 1774529495,
    lat: 35.4630324,
    lon: 139.6150688,
    prefecture: "神奈川県",
    tags: {
      name: "吉村家",
      "name:en": "Yoshimuraya",
      cuisine: "ramen",
      "addr:city": "横浜市",
      "addr:suburb": "横浜市西区",
      "addr:quarter": "岡野",
      "addr:block_number": "1丁目64",
      opening_hours: "11:00-20:00; Mo off",
      website: "http://ieke1.com/",
      phone: "+81-45-322-9988",
    },
  };

  it("既知ブランドから味の傾向を割り当てる", () => {
    expect(toShop(element)).toMatchObject({
      id: "node/1774529495",
      name: "吉村家",
      brand: "吉村家",
      taste: "rich",
      confidence: "confirmed",
      prefecture: "神奈川県",
      city: "横浜市",
      address: "西区岡野1丁目64",
      osmUrl: "https://www.openstreetmap.org/node/1774529495",
    });
  });

  it("座標を小数 6 桁に丸める", () => {
    const shop = toShop(element);
    expect(shop.lat).toBe(35.463032);
    expect(shop.lon).toBe(139.615069);
  });

  it("判定できないブランドの味は unknown にする", () => {
    const shop = toShop({ ...element, tags: { name: "ありがた家", cuisine: "ramen" } });
    expect(shop.taste).toBe("unknown");
    expect(shop.confidence).toBe("likely");
  });

  it("家系でない要素は null を返す", () => {
    expect(toShop({ ...element, tags: { name: "無敵家", cuisine: "ramen" } })).toBeNull();
  });
});
