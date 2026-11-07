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

  it("「迷ったら」は母数を出さず、並べた根拠だけ", () => {
    const label = formatCount("decide", 651, 3, decide);
    expect(label).not.toContain("651");
    expect(label).not.toMatch(/軒中/);
  });
});
