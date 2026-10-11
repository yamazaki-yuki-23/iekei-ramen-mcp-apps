import { describe, expect, it } from "vitest";
import { STAMP_OF } from "../src/lib/camera-post";
import { FRAMES, frameTexts, placeStamp } from "../src/camera/frames";

const meta = {
  name: "横浜家系ラーメン 石川家",
  area: "横浜市",
  date: new Date(2026, 9, 12, 18, 5),
};

describe("家系カメラのフレームと判子（#190）", () => {
  it("フレームに入る文字は、店名・地域・日付と決まった言葉だけ", () => {
    for (const { key } of FRAMES.filter((f) => f.key !== "none")) {
      const texts = frameTexts(key, meta).join("\n");
      expect(texts).toContain("横浜家系ラーメン 石川家");
      expect(texts).toContain("横浜市");
      expect(texts).toMatch(/2026[./]10[./]12/);
    }
  });

  it("フレームと判子に、店の評価の言葉を入れない", () => {
    const all = [
      ...FRAMES.flatMap(({ key }) => frameTexts(key, meta)),
      ...Object.values(STAMP_OF),
    ].join("\n");
    for (const word of ["人気", "おいしい", "美味しい", "おすすめ", "営業中"])
      expect(all).not.toContain(word);
  });

  it("判子は、傾けた外枠ごと写真に収まる（長い言葉・大きい判子・端に寄せたときも）", () => {
    const img = { x: 40, y: 60, w: 800, h: 600 };
    // 「ライス無限」は 5 文字（1 文字の幅を 1 とする）。
    for (const s of [
      { text: "ライス無限", x: 0.95, y: 0.05, size: 0.36 },
      { text: "沁みた", x: 0.05, y: 0.95, size: 0.16 },
      { text: "最高", x: 0.5, y: 0.5, size: 0.08 },
    ]) {
      const p = placeStamp(img, s, s.text.length);
      const cos = Math.abs(Math.cos(-0.17));
      const sin = Math.abs(Math.sin(-0.17));
      // 枠の線（太さは文字の大きさの 0.12）の外側まで含めて収まること。
      const ow = p.pw + p.size * 0.12;
      const oh = p.ph + p.size * 0.12;
      const hw = (cos * ow + sin * oh) / 2;
      const hh = (sin * ow + cos * oh) / 2;
      expect(p.cx - hw).toBeGreaterThanOrEqual(img.x - 1e-6);
      expect(p.cx + hw).toBeLessThanOrEqual(img.x + img.w + 1e-6);
      expect(p.cy - hh).toBeGreaterThanOrEqual(img.y - 1e-6);
      expect(p.cy + hh).toBeLessThanOrEqual(img.y + img.h + 1e-6);
    }
    // 小さく真ん中なら、そのまま。
    const small = placeStamp(img, { text: "最高", x: 0.5, y: 0.5, size: 0.08 }, 2);
    expect(small.size).toBeCloseTo(600 * 0.08);
    expect(small.cx).toBeCloseTo(440);
  });
});
