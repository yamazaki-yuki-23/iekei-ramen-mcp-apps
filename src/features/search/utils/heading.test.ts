import { describe, expect, it } from "vitest";
import type { DecideInfo } from "../../../types";
import { formatCount } from "./heading";

const decide: DecideInfo = {
  round: 0,
  rounds: 217,
  poolTotal: 651,
  basis: "distance",
  widened: false,
};

describe("formatCount（軒数の言い方、#369）", () => {
  it("検索の結果は「N 軒」「N 軒（M 軒を表示）」。「掲載」は付けない", () => {
    expect(formatCount("nearby", 5, 5, undefined)).toBe("5 軒");
    expect(formatCount("form", 863, 200, undefined)).toBe("863 軒（200 軒を表示）");
    expect(formatCount("map", 99, 99, undefined)).toBe("99 軒");
    for (const mode of ["form", "nearby", "map", "visited"] as const)
      expect(formatCount(mode, 12, 12, undefined)).not.toContain("掲載");
  });

  it("範囲で探す前の地図は、全国の数だと名乗る（#402）", () => {
    // 地図は一部の地域を映しているので、「857 軒」だけだと見えている店の数と取り違える。
    expect(formatCount("map", 857, 857, undefined, "全国")).toBe("全国 857 軒");
    // 範囲・県で絞った後は、見出しがどこの数かを名乗るので今のまま。
    expect(formatCount("map", 12, 12, undefined, "地図に出ている範囲")).toBe("12 軒");
    expect(formatCount("map", 99, 99, undefined, "神奈川県")).toBe("99 軒");
    // 地図のほかは、見出しの「全国の家系ラーメン」と一覧が同じものを指すので付けない。
    expect(formatCount("form", 857, 200, undefined, "全国")).toBe("857 軒（200 軒を表示）");
  });

  it("「迷ったら」は母数を出さず、並べた根拠だけ", () => {
    const label = formatCount("decide", 651, 3, decide);
    expect(label).not.toContain("651");
    expect(label).not.toMatch(/軒中/);
  });
});
