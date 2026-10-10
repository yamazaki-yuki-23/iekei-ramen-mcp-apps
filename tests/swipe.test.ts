import { describe, expect, it } from "vitest";
import {
  askAtEnd,
  askFor,
  chargeFor,
  DECIDED_ASK,
  exitFor,
  LOAD_FAILED_ASK,
  shareText,
} from "../src/lib/swipe";
import type { Shop } from "../src/lib/types";

const shop = (km?: number): Shop => ({
  id: "node/1",
  name: "試験家",
  taste: "unknown",
  confidence: "confirmed",
  prefecture: "神奈川県",
  lat: 35.46,
  lon: 139.62,
  osmUrl: "https://www.openstreetmap.org/node/1",
  distanceKm: km,
});
const base = { index: 1, seen: 0, passStreak: 0, left: 10, nearLeft: 0 };

describe("家系スワイプの問いかけ（#166）", () => {
  it("近い店は直線距離で問う（「直線」と書く）", () => {
    const ask = askFor({ ...base, shop: shop(0.4), nearLeft: 3 });
    expect(ask.text).toBe("直線 400m。行ける距離？");
    expect(ask.sub).toBe("この先 1km 以内に、あと 3 軒");
  });

  it("パスが 3 回続いたら、味の傾向を変える選択肢を出す（いちばん強い）", () => {
    const ask = askFor({ ...base, shop: shop(0.4), passStreak: 3 });
    expect(ask).toEqual({ text: "3 連続パス。味の傾向を変えてみる？", offerTaste: true });
  });

  it("5 枚ごとに見た数、それ以外は「ここ、知ってた？」と残りの数", () => {
    expect(askFor({ ...base, shop: shop(2), seen: 5, index: 6, left: 14 })).toEqual({
      text: "知らない家系、6 軒目。",
      sub: "この範囲に、あと 14 軒",
    });
    expect(askFor({ ...base, shop: shop(2), seen: 2 }).text).toBe("ここ、知ってた？");
  });

  it("文言に「人気」「おいしい」「営業中」「当たり」を使わない", () => {
    const lines = [
      askFor({ ...base, shop: shop(0.2), nearLeft: 4 }),
      askFor({ ...base, shop: shop(3), passStreak: 4 }),
      askFor({ ...base, shop: shop(3), seen: 10, index: 11 }),
      askFor({ ...base, shop: shop() }),
      askAtEnd(20),
      DECIDED_ASK,
      LOAD_FAILED_ASK,
    ].flatMap((a) => [a.text, a.sub ?? ""]);
    lines.push(shareText(["吉村家"]), shareText(["吉村家", "杉田家"]));
    for (const word of ["人気", "おいしい", "美味", "営業中", "当たり"])
      expect(lines.join("\n")).not.toContain(word);
  });
});

describe("出口とゲージ（#166）", () => {
  it("行きたいの数で出口が変わる: 1 → 地図 / 2〜3 → まわる店 / 4 以上 → 3 軒まで選ぶ", () => {
    expect([0, 1, 2, 3, 4, 9].map(exitFor)).toEqual([
      "none",
      "map",
      "route",
      "route",
      "pick",
      "pick",
    ]);
  });

  it("ゲージは行きたいとレア札で多めにたまる", () => {
    expect(chargeFor("pass", false)).toBe(6);
    expect(chargeFor("want", false)).toBe(14);
    expect(chargeFor("want", true)).toBe(30);
  });
});
