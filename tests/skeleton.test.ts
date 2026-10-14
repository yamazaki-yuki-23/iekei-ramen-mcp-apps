import { describe, expect, it } from "vitest";
import { countPlaceholder, resultLook, skeletonShops } from "../src/lib/skeleton";

describe("待つ間の見せ方（#214）", () => {
  it("返ってくる数が決まっている探し方は、その数だけ骨組みを出す（多いと届いたときに縮んで跳ねる）", () => {
    expect(skeletonShops("decide")).toHaveLength(3);
    // 「現在地から」は limit: 5 で呼ぶ（use-server-tools.ts）。
    expect(skeletonShops("nearby")).toHaveLength(5);
  });

  it("件数の札の場所取りは、本物の札と同じくらいの幅にする", () => {
    // 「行った店」は「N 軒」と短い。長い幅で取るとスマホ幅で次の行に回る。
    expect(countPlaceholder("visited").length).toBeLessThanOrEqual(4);
    expect(countPlaceholder("form").length).toBeGreaterThan(10);
    // 文字そのものは置かない（本物の札と取り違えさせない）。
    expect(countPlaceholder("form").trim()).toBe("");
  });

  it("同じ探し方の取り直しは前の結果を残し、違う探し方へ移るときは骨組み。どちらも 300ms までは見た目を変えない", () => {
    expect(resultLook(false, false, false)).toBe("live");
    expect(resultLook(true, true, false)).toBe("hold");
    expect(resultLook(true, true, true)).toBe("dim");
    expect(resultLook(true, false, false)).toBe("reserve");
    expect(resultLook(true, false, true)).toBe("skeleton");
  });
});
