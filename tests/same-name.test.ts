/**
 * 同名の店の見分け。
 *
 * **重複登録ではなく、チェーンの別店舗**が同じ文字列で並ぶのが問題。
 * 実データでは東京都に町田商店が 14 店ある。
 */
import { describe, expect, it } from "vitest";
import { metaParts, sameNameLabels } from "../src/lib/same-name";
import type { Shop } from "../src/lib/types";

const shop = (id: string, name: string, city?: string, address?: string): Shop =>
  ({ id, name, city, address, prefecture: "東京都" }) as Shop;

describe("sameNameLabels", () => {
  it("名前が重ならなければ何も出さない", () => {
    const labels = sameNameLabels([shop("1", "壱八家", "横浜市"), shop("2", "武蔵家", "新宿区")]);
    expect(labels.size).toBe(0);
  });

  it("同名なら市区町村で見分ける", () => {
    const labels = sameNameLabels([
      shop("1", "町田商店", "新宿区"),
      shop("2", "町田商店", "町田市"),
    ]);
    expect(labels.get("1")?.text).toBe("新宿区");
    expect(labels.get("2")?.text).toBe("町田市");
  });

  it("同じ市に 2 店あるときは、その 2 店に出さない", () => {
    /*
     * 出しても 2 枚に同じ文字が並ぶだけで何も分からない。出さなければ
     * 住所の行が丸ごと残る（町名まで出る）ので、そちらで見分けが付く。
     */
    const shops = [
      shop("1", "町田商店", "町田市", "矢部町"),
      shop("2", "町田商店", "町田市", "森野一丁目"),
    ];
    const labels = sameNameLabels(shops);
    expect(labels.size).toBe(0);
    // 住所は全部そのまま出る。
    expect(metaParts(shops[0], labels.get("1"))).toEqual(["東京都", "町田市", "矢部町"]);
  });

  it("同じ市の店と、その市に 1 軒だけの店が混ざるとき", () => {
    // 見分けが付く店にだけ出す。
    const shops = [
      shop("1", "町田商店", "町田市", "矢部町"),
      shop("2", "町田商店", "町田市", "森野一丁目"),
      shop("3", "町田商店", "新宿区", "西早稲田二丁目"),
    ];
    const labels = sameNameLabels(shops);
    expect(labels.has("1")).toBe(false);
    expect(labels.has("2")).toBe(false);
    expect(labels.get("3")).toEqual({ text: "新宿区", used: ["city"] });
  });

  it("市区町村が無ければ何も出さない（町名は住所の行に残る）", () => {
    /*
     * 町名で代えると、そこだけ長い文字列が入りうる（横 1 行の版面では
     * 縮めない指定なのではみ出す）。出さなければ住所の行に残る。
     */
    const labels = sameNameLabels([
      shop("1", "○○家", undefined, "矢部町"),
      shop("2", "○○家", "町田市", "森野一丁目"),
    ]);
    expect(labels.has("1")).toBe(false);
    expect(labels.get("2")).toEqual({ text: "町田市", used: ["city"] });
    // ラベルが無い店は、住所が全部そのまま出る。
    expect(metaParts(shop("1", "○○家", undefined, "矢部町"), labels.get("1"))).toEqual([
      "東京都",
      "矢部町",
    ]);
  });

  it("出すものが無ければ黙っている（空の括弧を作らない）", () => {
    const labels = sameNameLabels([shop("1", "町田商店"), shop("2", "町田商店")]);
    expect(labels.size).toBe(0);
  });
});

describe("metaParts", () => {
  it("見分けを出していない店は、そのまま全部出す", () => {
    const target = shop("1", "壱八家", "横浜市", "南幸二丁目");
    expect(metaParts(target)).toEqual(["東京都", "横浜市", "南幸二丁目"]);
  });

  it("市区町村だけを名前の隣に出したときは、町名を住所に残す", () => {
    /*
     * 「大和市」で見分けが付く店から町名まで消すと、持っている情報が
     * 画面から減る（Codex の指摘で気付いた）。
     */
    const target = shop("1", "壱六家", "大和市", "渋谷七丁目");
    expect(metaParts(target, { text: "大和市", used: ["city"] })).toEqual(["東京都", "渋谷七丁目"]);
  });

  it("市区町村を名前の隣に出したときは、住所から市区町村だけを外す", () => {
    const target = shop("1", "たかさご家", "横浜市", "野毛町二丁目");
    expect(metaParts(target, { text: "横浜市", used: ["city"] })).toEqual([
      "東京都",
      "野毛町二丁目",
    ]);
  });
});

describe("紛らわしい地名", () => {
  it("市区町村に町名が含まれていても、出していない町名は残す", () => {
    /*
     * 「府中市」に「府中」が含まれるような場合。文字列を見比べて判断すると、
     * 名前の隣に出していない町名まで住所の行から消える（Codex の指摘で気付いた）。
     * どの欄を使ったかを持ち回れば取り違えない。
     */
    const labels = sameNameLabels([
      shop("1", "○○家", "府中市", "府中"),
      shop("2", "○○家", "調布市", "布田"),
    ]);
    expect(labels.get("1")).toEqual({ text: "府中市", used: ["city"] });
    expect(metaParts(shop("1", "○○家", "府中市", "府中"), labels.get("1"))).toEqual([
      "東京都",
      "府中",
    ]);
  });
});
