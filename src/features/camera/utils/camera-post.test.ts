import { describe, expect, it } from "vitest";
import { body, COMMENTS, tagOf, threadsText, TONES, xText } from "./camera-post";

const shop = { name: "横浜家系ラーメン 石川家", city: "横浜市", prefecture: "神奈川県" };

describe("家系カメラの投稿文（#190）", () => {
  it("X はハッシュタグ 3 つ（家系ラーメン・店名・地域）、Threads はトピックタグ 1 つ", () => {
    const x = xText({ shop, tone: "plain" });
    expect(x).toContain("#家系ラーメン #横浜家系ラーメン石川家 #横浜市");
    const threads = threadsText({ shop, tone: "plain" });
    expect(threads.match(/#\S+/g)).toEqual(["#家系ラーメン"]);
    // 本文に URL を入れない（Threads で閲覧が落ちた、#44）。
    for (const t of [x, threads]) expect(t).not.toMatch(/https?:\/\//);
  });

  it("タグにできない空白・記号を外す", () => {
    expect(tagOf("極味家(家系ラーメン)")).toBe("#極味家家系ラーメン");
    expect(tagOf("ラーメン・ショップ")).toBe("#ラーメンショップ");
  });

  it("市区町村が無ければ都道府県を地域にする", () => {
    expect(body({ shop: { name: "壱八家", prefecture: "神奈川県" }, tone: "plain" })).toBe(
      "神奈川県の壱八家で一杯。",
    );
  });

  it("選んだひとこと感想だけが入る", () => {
    expect(body({ shop, tone: "plain", comment: "沁みた" })).toBe(
      "横浜市の横浜家系ラーメン 石川家で一杯。沁みた。",
    );
  });

  it("アプリから店の評価の言葉を入れない", () => {
    const all = TONES.flatMap(({ key }) =>
      [undefined, ...COMMENTS].map((comment) => xText({ shop, tone: key, comment })),
    ).join("\n");
    for (const word of ["人気", "おいしい", "美味しい", "営業中", "おすすめ"])
      expect(all).not.toContain(word);
  });
});
