import { describe, expect, it } from "vitest";
import {
  type Answer,
  isTypeKey,
  orderSpell,
  QUESTIONS,
  shareText,
  shareUrl,
  rarity,
  styleWords,
  tableTip,
  TYPES,
  typeFor,
} from "../src/lib/shindan";
import { faceSvg } from "../src/lib/shindan-face";

/** n 問 × 3 択の全通り。 */
const every = (n: number): Answer[][] =>
  [...Array(3 ** n).keys()].map((k) =>
    Array.from({ length: n }, (_, i) => (Math.floor(k / 3 ** i) % 3) as Answer),
  );

const typeOf = (a: number, b: number, c: number) => typeFor([a, b, c, 1, 1, 1] as Answer[]).name;

describe("家系タイプ診断（#167）", () => {
  it("タイプは麺・味・油の 3 問だけで決まり、27 通りの数は表のとおり", () => {
    const counts = new Map<string, number>();
    for (const three of every(3)) {
      const key = typeFor([...three, 1, 1, 1]).key;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      // ライス・卓上・スープを変えてもタイプは変わらない。
      for (const rest of every(3)) expect(typeFor([...three, ...rest]).key).toBe(key);
    }
    for (const type of Object.values(TYPES)) expect(counts.get(type.key)).toBe(type.combos);
    expect([...counts.values()].reduce((a, b) => a + b)).toBe(27);
  });

  it("決めた条件どおりのタイプになる", () => {
    expect(typeOf(0, 0, 0)).toBe("カタコイオオメ三冠王");
    expect(typeOf(1, 1, 1)).toBe("ふつうを極めし者");
    expect(typeOf(2, 0, 0)).toBe("濃厚フルスロットル");
    expect(typeOf(1, 0, 1)).toBe("一点豪華主義");
    expect(typeOf(0, 1, 0)).toBe("カタメ一択");
    expect(typeOf(1, 2, 1)).toBe("さじ加減の職人");
    expect(typeOf(2, 2, 0)).toBe("明日の自分にやさしい人");
    expect(typeOf(0, 2, 1)).toBe("我流の調合師");
  });

  it("珍しさは組み合わせの数で、言葉のバッジ（激レア・レア・定番）", () => {
    expect(rarity(TYPES.sankan)).toBe("激レア");
    expect(rarity(TYPES.katame)).toBe("レア");
    expect(rarity(TYPES.garyu)).toBe("定番");
  });

  it("注文の言葉・流儀は答えたとおり", () => {
    expect(orderSpell([0, 0, 0])).toBe("カタメ・コイメ・オオメ");
    expect(orderSpell([2, 1, 2])).toBe("ヤワメ・ふつう・スクナメ");
    expect(orderSpell([1, 1, 1])).toBe("全部ふつう");
    expect(styleWords([1, 1, 1, 0, 1, 0])).toEqual([
      "ライスおかわり派",
      "ちょい足し派",
      "スープ完飲派",
    ]);
  });

  it("相方はどれも 8 タイプのどれか", () => {
    for (const type of Object.values(TYPES)) expect(isTypeKey(type.partner)).toBe(true);
  });

  it("結果の文言に、店との相性や評判の言葉を入れない", () => {
    const texts = [
      ...Object.values(TYPES).flatMap((t) => [
        t.name,
        t.catch,
        ...t.aruaru,
        t.partnerWhy,
        shareText(t, "全部ふつう"),
      ]),
      ...[0, 1, 2].map((a) => tableTip([1, 1, 1, 1, a as Answer, 1])),
    ].join("\n");
    for (const word of ["合う店", "相性", "おすすめ", "人気", "おいしい", "営業中", "当たり"])
      expect(texts).not.toContain(word);
  });

  it("シェアの URL はタイプだけを持ち、文面は決めたとおり", () => {
    expect(shareUrl("sankan")).toBe("https://iekeiramen.com/shindan/sankan/");
    expect(shareText(TYPES.sankan, "カタメ・コイメ・オオメ")).toBe(
      "私の家系の注文は『カタメ・コイメ・オオメ』、カタコイオオメ三冠王でした。あなたは？",
    );
  });

  it("丼のキャラクターは 8 タイプとも違う絵になる", () => {
    const svgs = Object.values(TYPES).map((t) => faceSvg(t.key, 100));
    expect(new Set(svgs).size).toBe(8);
    expect(QUESTIONS).toHaveLength(6);
  });
});
