import { describe, expect, it } from "vitest";
import { type Answer, rarity, TYPES as V1_TYPES } from "../src/utils/shindan";
import {
  ALL_TYPES,
  CURRENT_EDITION,
  EDITIONS,
  editionOf,
  pickEdition,
} from "../src/utils/shindan-editions";
import { QUESTIONS, shareText, spell, styleWords, TYPES, typeFor } from "../src/utils/shindan-v2";
import { faceSvg } from "../src/utils/shindan-face";

/** n 問 × 3 択の全通り。 */
const every = (n: number): Answer[][] =>
  [...Array(3 ** n).keys()].map((k) =>
    Array.from({ length: n }, (_, i) => (Math.floor(k / 3 ** i) % 3) as Answer),
  );

/**
 * #410 の判定を、表の言い方のまま書き直したもの（実装と別に書いて、食い違いを見張る）。
 * 問い 1 が海苔、2 がトッピング、3 が卓上。0 が「楽しみ尽くす」、2 が「そのまま」。
 */
function expected([nori, topping, table]: Answer[]): string {
  if (nori === 0 && topping === 0 && table === 0) return "sansoryu";
  if (nori === 2 && topping === 2 && table === 2) return "chakudon";
  if (nori === 0 && topping !== 0 && table !== 0) return "norimaki";
  if (topping === 0 && table !== 0) return "zenbunose";
  if (table === 0 && topping !== 0) return "takujo";
  if (topping === 0 && table === 0 && nori !== 0) return "yokubari";
  if ([nori, topping, table].filter((a) => a === 2).length >= 2) return "soup";
  return "choitashi";
}

describe("家系タイプ診断の 2 版（#410）", () => {
  it("27 通りが判定どおりのタイプになり、流儀の 3 問ではタイプが変わらない", () => {
    const counts = new Map<string, number>();
    for (const three of every(3)) {
      const key = typeFor([...three, 1, 1, 1]).key;
      expect(key, `答え ${three.join("")}`).toBe(expected(three));
      counts.set(key, (counts.get(key) ?? 0) + 1);
      for (const rest of every(3)) expect(typeFor([...three, ...rest]).key).toBe(key);
    }
    // 表の通り数（1・1・4・6・6・2・3・4）と、珍しさの数が合う。
    expect(Object.fromEntries(counts)).toEqual({
      sansoryu: 1,
      chakudon: 1,
      norimaki: 4,
      zenbunose: 6,
      takujo: 6,
      yokubari: 2,
      soup: 3,
      choitashi: 4,
    });
    for (const type of Object.values(TYPES)) expect(counts.get(type.key)).toBe(type.combos);
  });

  it("珍しさは 1 版と同じ決まり", () => {
    expect(rarity(TYPES.sansoryu)).toBe("激レア");
    expect(rarity(TYPES.yokubari)).toBe("レア");
    expect(rarity(TYPES.soup)).toBe("レア");
    expect(rarity(TYPES.choitashi)).toBe("定番");
  });

  it("食べ方の言葉・流儀・シェア文は答えたとおり", () => {
    expect(spell([0, 0, 0])).toBe("海苔巻き・全部のせ・味変");
    expect(spell([1, 2, 1])).toBe("途中で海苔・足さない・一つだけ");
    expect(styleWords([0, 0, 0, 0, 1, 2])).toEqual([
      "スープから派",
      "だれかと派",
      "ほうれん草よけがち派",
    ]);
    expect(shareText(TYPES.sansoryu, "海苔巻き・全部のせ・味変")).toBe(
      "私の家系の食べ方は『海苔巻き・全部のせ・味変』、家系三刀流でした。あなたは？",
    );
    expect(QUESTIONS[2].note).toBe("卓上の調味料は店によって違います");
  });

  it("相方は 2 版の中で、互いに指し合う", () => {
    for (const type of Object.values(TYPES)) {
      const partner = TYPES[type.partner];
      expect(partner.partner).toBe(type.key);
      expect(partner.partnerWhy).toBe(type.partnerWhy);
    }
  });

  it("結果の文言に、店との相性や評判の言葉を入れない", () => {
    const texts = Object.values(TYPES)
      .flatMap((t) => [t.name, t.catch, ...t.aruaru, t.partnerWhy])
      .join("\n");
    for (const word of ["合う店", "おすすめの店", "おいしい店", "人気", "評判", "行くべき"])
      expect(texts).not.toContain(word);
  });
});

describe("診断の版（#410）", () => {
  it("今は 2 版を出し、設定 1 か所で 1 版にも戻せる", () => {
    expect(CURRENT_EDITION).toBe(2);
    expect(pickEdition()).toBe(EDITIONS[2]);
    expect(EDITIONS[1].questions[0].title).toBe("麺の硬さは？");
  });

  it("1 版と 2 版のタイプの key は重ならず、どれも key から引けて、版の言葉に合う", () => {
    const v1 = Object.keys(V1_TYPES);
    const v2 = Object.keys(TYPES);
    expect(v1.filter((k) => v2.includes(k))).toEqual([]);
    expect(Object.keys(ALL_TYPES).toSorted()).toEqual([...v1, ...v2].toSorted());
    expect(editionOf("sankan").words.spell).toBe("あなたの注文");
    expect(editionOf("sansoryu").words.spell).toBe("あなたの食べ方");
  });

  it("2 版のタイプにも丼の顔がある（シェア画像にも使う）", () => {
    for (const key of Object.keys(TYPES) as (keyof typeof TYPES)[])
      expect(faceSvg(key, 120)).toMatch(/^<svg .*<\/svg>$/);
  });
});
