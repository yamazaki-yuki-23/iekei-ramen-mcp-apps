import { describe, expect, it } from "vitest";
// @ts-expect-error データ生成スクリプトと共有する素の JS モジュール
import {
  buildAddress,
  knownFacts,
  resolveDuplicates,
  tagsFingerprint,
  toShop,
} from "../scripts/classify.mjs";
// @ts-expect-error 同上
import { decide } from "../scripts/judgments.mjs";

/** OSM のタグを組み立てる小さなヘルパ。 */
const tags = (t: Record<string, string>) => t;

/** TypeSafe の回答の形。テストでは確率だけ差し替える。 */
const answers = (o: Partial<Record<string, number>> & { genre?: Record<string, number> } = {}) => ({
  is_ramen_shop: { noul: o.is_ramen_shop ?? 0.95 },
  name_declares_iekei: { noul: o.name_declares_iekei ?? 0.05 },
  known_iekei_brand: { noul: o.known_iekei_brand ?? 0.1 },
  yago_is_ya: { noul: o.yago_is_ya ?? 0.9 },
  genre: { choice: "unclear", probabilities: { iekei: 0.02, unclear: 0.95, ...o.genre } },
});

describe("knownFacts — 対応表で分かること", () => {
  it("既知の家系ブランドと味を引く", () => {
    expect(knownFacts(tags({ name: "吉村家" }))).toMatchObject({
      iekeiBrand: "吉村家",
      taste: "rich",
    });
  });

  it("brand タグ側のブランドも引く", () => {
    expect(knownFacts(tags({ name: "ラーメン", brand: "壱角家" })).iekeiBrand).toBe("壱角家");
  });

  it("家系ではないと分かっている店を印付けする", () => {
    expect(knownFacts(tags({ name: "無敵家" })).notIekei).toBe("無敵家");
  });

  it("店名そのものの除外はブランドの部分一致より優先する", () => {
    // 「杉田家住宅」は「杉田家」を含むが文化財。飲食店ですらない
    const f = knownFacts(tags({ name: "杉田家住宅" }));
    expect(f.notIekei).toBe("杉田家住宅");
    expect(f.iekeiBrand).toBeUndefined();
    expect(decide(answers(), f).verdict).toBeNull();
  });

  it("brand タグ側だけの除外はブランド照合を妨げない", () => {
    // 魂心家に brand=幸楽苑 が付いている実例がある。タグの誤りのほうを疑う
    const f = knownFacts(tags({ name: "魂心家", brand: "幸楽苑" }));
    expect(f.iekeiBrand).toBe("魂心家");
    expect(decide(answers(), f).verdict).toBe("confirmed");
  });

  it("対応表に無ければ何も返さない", () => {
    const f = knownFacts(tags({ name: "ありがた家" }));
    expect(f.iekeiBrand).toBeUndefined();
    expect(f.notIekei).toBeUndefined();
  });
});

describe("decide — 対応表がモデルより優先される", () => {
  it("既知ブランドなら、モデルが判断できなくても確定にする", () => {
    // 町田商店は cuisine=noodle のせいでモデルが ramen 0.34 を返した実例がある
    const d = decide(answers({ is_ramen_shop: 0.34 }), { iekeiBrand: "町田商店", taste: "chain" });
    expect(d).toMatchObject({ verdict: "confirmed", taste: "chain" });
  });

  it("誤った brand タグで既知ブランドを落とさない", () => {
    // 実データに brand=幸楽苑 が付いた魂心家がある。除外リストが先に効くと消えてしまう
    const d = decide(answers(), { iekeiBrand: "魂心家", taste: "creamy", notIekei: "幸楽苑" });
    expect(d.verdict).toBe("confirmed");
  });

  it("家系ではないと分かっている店は落とす", () => {
    expect(decide(answers(), { notIekei: "無敵家" }).verdict).toBeNull();
  });
});

describe("decide — 3 段階の切り分け", () => {
  it("店名が家系を名乗っていれば確定にする", () => {
    expect(decide(answers({ name_declares_iekei: 0.97 })).verdict).toBe("confirmed");
  });

  it("名乗りとジャンルが両方そこそこ高ければ確定にする", () => {
    // 「横浜ラーメン 田上家」— 家系を名乗っているとも地名とも読めるので
    // name_declares_iekei が 0.87 止まりになる。単独の閾値 0.9 では拾えない
    const d = decide(answers({ name_declares_iekei: 0.87, genre: { iekei: 0.92, unclear: 0.03 } }));
    expect(d.verdict).toBe("confirmed");
  });

  it("片方だけ高くても確定にはしない", () => {
    // 名乗っていないが、ジャンルは家系だと推定できる店
    expect(
      decide(answers({ name_declares_iekei: 0.4, genre: { iekei: 0.96, unclear: 0.02 } })).verdict,
    ).toBe("likely");
    // 名乗りだけ中程度で、ジャンルの手がかりが無い店
    expect(decide(answers({ name_declares_iekei: 0.7, yago_is_ya: 0.9 })).verdict).toBe(
      "candidate",
    );
  });

  it("ジャンルが家系だと分かれば likely にする", () => {
    expect(decide(answers({ genre: { iekei: 0.94, unclear: 0.03 } })).verdict).toBe("likely");
  });

  it("ジャンルを判断できず屋号が「〜家」なら candidate にする", () => {
    expect(decide(answers({ yago_is_ya: 0.93 })).verdict).toBe("candidate");
  });

  it("屋号が「〜家」でなければ candidate にもしない", () => {
    // 「麺家 光」「自家製麺 Ken」のように、家が屋号以外の語に入っているもの
    expect(decide(answers({ yago_is_ya: 0.11 })).verdict).toBeNull();
  });

  it("別ジャンルだと分かっているものは落とす", () => {
    // 「博多ラーメン琥家」— 屋号は〜家だが博多とんこつ
    const d = decide(answers({ yago_is_ya: 0.87, genre: { iekei: 0.02, unclear: 0.03 } }));
    expect(d.verdict).toBeNull();
  });

  it("ラーメン店でなければ落とす", () => {
    expect(decide(answers({ is_ramen_shop: 0.3 })).verdict).toBeNull();
  });

  it("味は対応表に無ければ推測しない", () => {
    expect(decide(answers({ name_declares_iekei: 0.97 })).taste).toBe("unknown");
  });
});

describe("tagsFingerprint — 判定キャッシュの無効化", () => {
  it("タグが変われば指紋も変わる", () => {
    const a = tagsFingerprint(tags({ name: "吉村家", cuisine: "ramen" }));
    const b = tagsFingerprint(tags({ name: "別の店", cuisine: "ramen" }));
    expect(a).not.toBe(b);
  });

  it("タグが増えても変わる", () => {
    const a = tagsFingerprint(tags({ name: "吉村家" }));
    const b = tagsFingerprint(tags({ name: "吉村家", brand: "吉村家" }));
    expect(a).not.toBe(b);
  });

  it("キーの順序では変わらない", () => {
    // Overpass の応答でキー順が変わっても再判定しないように
    const a = tagsFingerprint(tags({ name: "吉村家", cuisine: "ramen" }));
    const b = tagsFingerprint(tags({ cuisine: "ramen", name: "吉村家" }));
    expect(a).toBe(b);
  });
});

/** id → タグ数。多いほうを残す。 */
const weight = (o: Record<string, number>) => new Map(Object.entries(o));

describe("resolveDuplicates — 同一店舗のまとめ方", () => {
  it("2 件ならタグの多いほうを残す", () => {
    const d = resolveDuplicates([{ a: "node/1", b: "way/2" }], weight({ "node/1": 3, "way/2": 9 }));
    expect([...d]).toEqual(["node/1"]);
  });

  it("3 件が同じ店なら 1 件だけ残す", () => {
    // A=B と A=C が成り立つとき、ペアごとに処理すると B と C が両方残ってしまう
    const d = resolveDuplicates(
      [
        { a: "node/A", b: "node/B" },
        { a: "node/A", b: "node/C" },
      ],
      weight({ "node/A": 1, "node/B": 5, "node/C": 3 }),
    );
    expect([...d].toSorted()).toEqual(["node/A", "node/C"]);
  });

  it("鎖状につながっていても 1 件に畳む", () => {
    const d = resolveDuplicates(
      [
        { a: "node/A", b: "node/B" },
        { a: "node/B", b: "node/C" },
        { a: "node/C", b: "node/D" },
      ],
      weight({ "node/A": 1, "node/B": 2, "node/C": 9, "node/D": 4 }),
    );
    expect([...d].toSorted()).toEqual(["node/A", "node/B", "node/D"]);
  });

  it("別々のグループは混ぜない", () => {
    const d = resolveDuplicates(
      [
        { a: "node/A", b: "node/B" },
        { a: "node/X", b: "node/Y" },
      ],
      weight({ "node/A": 9, "node/B": 1, "node/X": 1, "node/Y": 9 }),
    );
    expect([...d].toSorted()).toEqual(["node/B", "node/X"]);
  });

  it("タグ数が同じなら id 順で決める（実行ごとに変わらない）", () => {
    const pairs = [{ a: "node/2", b: "node/1" }];
    const w = weight({ "node/1": 4, "node/2": 4 });
    expect([...resolveDuplicates(pairs, w)]).toEqual(["node/2"]);
    expect([...resolveDuplicates([{ a: "node/1", b: "node/2" }], w)]).toEqual(["node/2"]);
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

  it("街区符号と住居番号を「-」で繋ぐ", () => {
    // 続けて書くと「下忍」+「3594」+「1」が「下忍35941」になる
    expect(
      buildAddress(
        tags({
          "addr:city": "鴻巣市",
          "addr:quarter": "下忍",
          "addr:block_number": "3594",
          "addr:housenumber": "1",
        }),
      ),
    ).toEqual({ city: "鴻巣市", address: "下忍3594-1" });
  });

  it("丁目まで含む住所を組み立てる", () => {
    expect(
      buildAddress(
        tags({
          "addr:city": "札幌市",
          "addr:suburb": "東区",
          "addr:quarter": "東雁来7条",
          "addr:neighbourhood": "1丁目",
          "addr:block_number": "4",
          "addr:housenumber": "32",
        }),
      ),
    ).toEqual({ city: "札幌市", address: "東区東雁来7条1丁目4-32" });
  });

  it("街区符号だけならそのまま続ける", () => {
    expect(
      buildAddress(
        tags({
          "addr:quarter": "藤野2条",
          "addr:neighbourhood": "13丁目",
          "addr:block_number": "231",
        }),
      ),
    ).toEqual({ city: undefined, address: "藤野2条13丁目231" });
  });

  it("city が無くても住所を組み立てる", () => {
    expect(
      buildAddress(tags({ "addr:neighbourhood": "平沼", "addr:block_number": "1-6-14" })),
    ).toEqual({ city: undefined, address: "平沼1-6-14" });
  });

  it("city に正規表現のメタ文字が入っていても壊れない", () => {
    expect(buildAddress(tags({ "addr:city": "A+B市", "addr:quarter": "本町" }))).toEqual({
      city: "A+B市",
      address: "本町",
    });
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
  const judged = { verdict: "confirmed", taste: "rich" };

  it("判定結果とタグから Shop を組み立てる", () => {
    expect(toShop(element, judged)).toMatchObject({
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
    const shop = toShop(element, judged);
    expect(shop.lat).toBe(35.463032);
    expect(shop.lon).toBe(139.615069);
  });

  it("candidate も Shop になる", () => {
    const shop = toShop(
      { ...element, tags: { name: "ありがた家", cuisine: "ramen" } },
      { verdict: "candidate", taste: "unknown" },
    );
    expect(shop).toMatchObject({ confidence: "candidate", taste: "unknown" });
  });

  it("判定が無い要素は null を返す", () => {
    expect(toShop(element, undefined)).toBeNull();
    expect(toShop(element, { verdict: null, taste: "unknown" })).toBeNull();
  });
});
