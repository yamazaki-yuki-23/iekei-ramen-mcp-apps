/**
 * 「行った店」の画面の出し分け。
 *
 * **記録の件数と、出せる店の数がずれる**場面がここの全部。データを取り直して
 * 店が消えると、記録は残ったまま一覧から落ちる（サーバーは実在する店だけを返す）。
 */
import { describe, expect, it } from "vitest";
import { visitedView } from "../src/lib/visited-view";

describe("visitedView", () => {
  it("1 軒も記録が無いときは、消す導線を出さない", () => {
    const view = visitedView(0, 0);
    expect(view.showForget).toBe(false);
    expect(view.empty).toContain("まだ記録がありません");
  });

  it("記録があるなら、一覧に出せる店が無くても消せる", () => {
    /*
     * 消えた店の記録だけが残っている状態。ここで導線を隠すと、**自分の記録を
     * 自分で消せなくなる**（記録は残り続けるのに、画面からは触れない）。
     */
    const view = visitedView(0, 2);
    expect(view.showForget).toBe(true);
    // 「0 件」と言い切らない。記録は残っている。
    expect(view.empty).toContain("店舗データ");
    expect(view.empty).not.toContain("まだ記録がありません");
  });

  it("ふつうに並んでいるときは、空の文を出さない", () => {
    expect(visitedView(3, 3)).toEqual({ showForget: true });
  });
});
