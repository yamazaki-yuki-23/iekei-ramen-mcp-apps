import { describe, expect, it } from "vitest";
import { normalizeBounds } from "../src/lib/bounds";
import type { Bounds } from "../src/lib/types";

/** 横浜あたりを囲む、ふつうの範囲。 */
const YOKOHAMA = { north: 35.52, south: 35.42, east: 139.68, west: 139.58 };
const WHOLE_WORLD = { east: 180, west: -180 };

/**
 * 折り返した値の比較。
 *
 * **厳密一致で見ない。** 360 度の剰余を取る以上、1e-13 度ほどの誤差は必ず出る
 * （地球上で 0.01mm 以下）。ここを厳密に縛ると、意味の無い桁でテストが割れる。
 */
function expectSameBox(actual: Bounds, expected: Bounds) {
  expect(actual.north).toBeCloseTo(expected.north, 10);
  expect(actual.south).toBeCloseTo(expected.south, 10);
  expect(actual.east).toBeCloseTo(expected.east, 10);
  expect(actual.west).toBeCloseTo(expected.west, 10);
}

describe("normalizeBounds", () => {
  it("ふつうの範囲はそのまま通す", () => {
    expect(normalizeBounds(YOKOHAMA)).toEqual(YOKOHAMA);
  });

  it("隣の複製に居ても、実際の経度に戻す", () => {
    /*
     * 地図は世界を横に繰り返して描くので、隣の複製まで動かすと経度が
     * 480〜510 のようになる。両端を 180 に丸めると幅ゼロの範囲になり、
     * 日本が画面に出ているのに 0 件が返っていた。
     */
    const oneWorldEast = {
      ...YOKOHAMA,
      east: YOKOHAMA.east + 360,
      west: YOKOHAMA.west + 360,
    };

    expectSameBox(normalizeBounds(oneWorldEast), YOKOHAMA);
  });

  it("2 周ぶん離れていても戻す", () => {
    const twoWorldsWest = {
      ...YOKOHAMA,
      east: YOKOHAMA.east - 720,
      west: YOKOHAMA.west - 720,
    };

    expectSameBox(normalizeBounds(twoWorldsWest), YOKOHAMA);
  });

  it("1 周以上が画面に入っているなら世界全体", () => {
    expect(normalizeBounds({ north: 60, south: -60, east: 400, west: 0 })).toEqual({
      north: 60,
      south: -60,
      ...WHOLE_WORLD,
    });
  });

  it("日付変更線をまたぐなら、0 件にせず世界全体として渡す", () => {
    // 南西 → 北東の箱で表せない。見えている店を「無い」と答えるより広く返す。
    expect(normalizeBounds({ north: 45, south: 30, east: 190, west: 170 })).toEqual({
      north: 45,
      south: 30,
      ...WHOLE_WORLD,
    });
  });

  it("上下に振り切って高さがゼロになったら、誤りにせず世界全体", () => {
    /*
     * 地図は世界の外まで引きずれるので、上に振り切ると南北が同じ値に潰れる。
     * サーバーは面積ゼロの範囲を「呼び出し側の誤り」として弾くが、これは
     * ユーザーの操作で起きるので、誤りではなく広い範囲として返す。
     */
    expect(normalizeBounds({ north: 95, south: 92, east: 139.6, west: 139.5 })).toEqual({
      north: 90,
      south: -90,
      ...WHOLE_WORLD,
    });
  });

  it("緯度は ±90 に丸める", () => {
    // 引ききると地図は極を越えた値を返す。経度と違って折り返しても意味が無い。
    expect(normalizeBounds({ north: 95, south: -95, east: 10, west: -10 })).toEqual({
      north: 90,
      south: -90,
      east: 10,
      west: -10,
    });
  });
});
