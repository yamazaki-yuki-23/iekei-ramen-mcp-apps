/**
 * 公開前の確認。**見分けが付かない同名の店を出さない。**
 *
 * UI（src/lib/same-name.ts）は市区町村で足りなければ町名まで降りるので、
 * 同名どうしで (市区町村, 町名) が重なっていなければ必ず見分けが付く。
 * ここでは、その前提が崩れていないかを材料の側から見る。
 */
import { describe, expect, it } from "vitest";
import { findAmbiguous } from "../scripts/labels.mjs";

const shop = (id: string, name: string, city?: string, address?: string) => ({
  id,
  name,
  city,
  address,
  prefecture: "東京都",
});

describe("findAmbiguous", () => {
  it("同名でも市区町村が違えば通す", () => {
    expect(
      findAmbiguous([shop("1", "町田商店", "新宿区"), shop("2", "町田商店", "町田市")]),
    ).toEqual([]);
  });

  it("同じ市でも町名が違えば通す", () => {
    const shops = [
      shop("1", "町田商店", "町田市", "矢部町"),
      shop("2", "町田商店", "町田市", "森野一丁目"),
    ];
    expect(findAmbiguous(shops)).toEqual([]);
  });

  it("同じ市で町名が無い同名は止める", () => {
    // 逆引きで町名が取れない土地はある。そこに同名の店が 2 つ来ると、
    // どう出しても同じ文字列になる。
    const found = findAmbiguous([shop("1", "大和家", "八王子市"), shop("2", "大和家", "八王子市")]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "大和家", label: "八王子市", ids: ["1", "2"] });
  });

  it("名前が重ならなければ何も言わない", () => {
    expect(findAmbiguous([shop("1", "壱八家", "横浜市"), shop("2", "武蔵家", "横浜市")])).toEqual(
      [],
    );
  });
});
