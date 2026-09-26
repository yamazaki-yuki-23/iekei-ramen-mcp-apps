import { describe, expect, it } from "vitest";
import { scopeLabel } from "../src/lib/scope";

const BOUNDS = { north: 35.48, south: 35.44, east: 139.65, west: 139.6 };

describe("scopeLabel", () => {
  it("範囲で絞ったときは「全国」と名乗らない", () => {
    // 画面に「全国の家系ラーメン 489 件」と出たまま、モデルには
    // 「地図に出ている範囲」と伝わっていた。語を 1 か所から取る。
    expect(scopeLabel({ bounds: BOUNDS })).toBe("地図に出ている範囲");
  });

  it("両方が効いているなら、両方を名乗る", () => {
    /*
     * 絞り込みは両方の重なりになる。範囲だけを名乗ると、枠が県境をまたいで
     * いた場合に、県の外の店が黙って落ちているのに「見えている範囲の全部」と
     * 読めてしまう。
     */
    expect(scopeLabel({ prefecture: "東京都", bounds: BOUNDS })).toBe(
      "地図に出ている範囲（東京都）",
    );
  });

  it("県だけなら県名、条件が無ければ全国", () => {
    expect(scopeLabel({ prefecture: "神奈川県" })).toBe("神奈川県");
    expect(scopeLabel({})).toBe("全国");
  });
});
