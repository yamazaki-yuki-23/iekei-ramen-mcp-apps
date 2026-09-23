import { describe, expect, it } from "vitest";
import { formatDistance } from "../src/lib/geo";
import { describeLeg, googleMapsRouteUrl, MAX_STOPS, planRoute } from "../src/lib/route";
import type { Origin, Shop } from "../src/lib/types";

/** 横浜駅あたり。 */
const ORIGIN: Origin = { lat: 35.4657, lon: 139.622, label: "横浜駅", source: "place" };

/** 指定した km だけ北へずらした店。距離の順番を作るために使う。 */
function shopAt(id: string, kmNorth: number): Shop {
  return {
    id,
    name: id,
    taste: "unknown",
    confidence: "confirmed",
    prefecture: "神奈川県",
    lat: ORIGIN.lat + kmNorth / 111,
    lon: ORIGIN.lon,
    osmUrl: `https://www.openstreetmap.org/${id}`,
  };
}

describe("planRoute", () => {
  it("基準地点があれば、そこから近い順に回る", () => {
    const route = planRoute([shopAt("far", 9), shopAt("near", 1), shopAt("mid", 5)], ORIGIN);
    expect(route.legs.map((l) => l.shop.id)).toEqual(["near", "mid", "far"]);
    expect(route.fromOrigin).toBe(true);
    // 1 軒目にも基準地点からの距離が入る。
    expect(route.legs[0].fromPreviousKm).toBeCloseTo(1, 1);
  });

  it("基準地点が無ければ、出発する店も含めて選ぶ", () => {
    /*
     * 端から始めないと戻る形になる並び。近い方から貪欲に選ぶと
     * mid → near → far で 4 + 8 = 12km になるが、端から回れば 8km で済む。
     */
    const route = planRoute([shopAt("mid", 5), shopAt("near", 1), shopAt("far", 9)]);
    expect(route.legs.map((l) => l.shop.id)).toEqual(["near", "mid", "far"]);
    expect(route.fromOrigin).toBe(false);
    // 出発点なので、1 軒目までの距離は数えない。
    expect(route.legs[0].fromPreviousKm).toBeUndefined();
    expect(route.totalKm).toBeCloseTo(8, 1);
  });

  it.each([
    // [1 軒目までの km, 2 軒目までの km, 区間の表示, 合計の表示]
    [1.04, 2.08, ["1.0km", "1.0km"], "2.0km"],
    [1.05, 2.1, ["1.1km", "1.1km"], "2.2km"],
    [0.5, 1.54, ["501m", "1.0km"], "1.5km"],
  ])("合計は、画面に出る区間の数字を足したものと一致する（%s / %s）", (a, b, legs, total) => {
    /*
     * 内部の細かい値のまま足すと、画面と食い違う。1.042km が 2 区間だと
     * 「1.0km + 1.0km」と出るのに、合計は 2.084 → 「2.1km」になっていた。
     * 区間を画面の桁で持ち、そこから合計を出す。
     */
    const route = planRoute([shopAt("a", a), shopAt("b", b)], ORIGIN);
    expect(route.legs.map((leg) => formatDistance(leg.fromPreviousKm!))).toEqual(legs);
    expect(formatDistance(route.totalKm)).toBe(total);
  });

  it("同じ条件なら毎回同じ順路になる", () => {
    const shops = [shopAt("a", 3), shopAt("b", 1), shopAt("c", 2)];
    const first = planRoute(shops, ORIGIN).legs.map((l) => l.shop.id);
    const second = planRoute(shops, ORIGIN).legs.map((l) => l.shop.id);
    expect(second).toEqual(first);
  });

  it("並びは、表示の桁ではなく生の距離で選ぶ", () => {
    /*
     * 出発点から 1.04km の far と 1.02km の near。表示はどちらも「1.0km」なので、
     * 丸めた値で比べると合計が同点になり、入力順（far が先）が残ってしまう。
     * 実際は near の方が近く、そちらから回る方が 0.02km 短い。
     *
     * 表示の桁で並びを決めると、短い順に回れるという約束が崩れ、その並びが
     * そのまま地図アプリへ渡る。丸めるのは並びを決めたあとだけ。
     */
    const route = planRoute([shopAt("far", 1.04), shopAt("near", 1.02)], ORIGIN);
    expect(route.legs.map((l) => l.shop.id)).toEqual(["near", "far"]);
    // 画面にはどちらも「1.0km」と出る（だから丸めでは区別できない）。
    expect(formatDistance(route.legs[0].fromPreviousKm!)).toBe("1.0km");
  });

  it("同じ距離なら、積んだ順を崩さない", () => {
    // 3 軒が同じ場所。並べ替える理由が無いので、ユーザーが積んだ順のまま。
    const shops = [shopAt("a", 2), shopAt("b", 2), shopAt("c", 2)];
    expect(planRoute(shops, ORIGIN).legs.map((l) => l.shop.id)).toEqual(["a", "b", "c"]);
  });

  it("上限を超えた分は切る", () => {
    const shops = ["a", "b", "c", "d"].map((id, i) => shopAt(id, i + 1));
    expect(planRoute(shops, ORIGIN).legs).toHaveLength(MAX_STOPS);
  });

  it("1 軒でも順路として扱える", () => {
    const route = planRoute([shopAt("only", 2)], ORIGIN);
    expect(route.legs).toHaveLength(1);
    expect(route.totalKm).toBeCloseTo(2, 1);
  });

  it("空なら空のまま返す（呼び出し側で分岐させない）", () => {
    expect(planRoute([])).toEqual({ legs: [], totalKm: 0, fromOrigin: false });
  });
});

describe("外部地図の URL", () => {
  const route = planRoute([shopAt("near", 1), shopAt("mid", 5), shopAt("far", 9)], ORIGIN);

  it("Google は最後の店を目的地、間を経由地にする", () => {
    const url = new URL(googleMapsRouteUrl(route, ORIGIN));
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("origin")).toBe(`${ORIGIN.lat},${ORIGIN.lon}`);
    expect(url.searchParams.get("destination")).toBe(
      `${route.legs[2].shop.lat},${route.legs[2].shop.lon}`,
    );
    expect(url.searchParams.get("waypoints")?.split("|")).toHaveLength(2);
    expect(url.searchParams.get("travelmode")).toBe("walking");
  });

  it("基準地点が無ければ origin を省く（地図側が現在地を使う）", () => {
    /*
     * こちらで 1 軒目を出発点に仕立てると、その店には「もう着いている」
     * ことになってしまう。省けば地図アプリが現在地から引いてくれる。
     */
    const noOrigin = planRoute([shopAt("a", 1), shopAt("b", 5)]);
    const url = new URL(googleMapsRouteUrl(noOrigin));
    expect(url.searchParams.has("origin")).toBe(false);
    expect(url.searchParams.get("waypoints")).toBe(
      `${noOrigin.legs[0].shop.lat},${noOrigin.legs[0].shop.lon}`,
    );
  });

  it("空の順路には URL を作らない", () => {
    expect(googleMapsRouteUrl(planRoute([]))).toBe("");
  });
});

describe("describeLeg", () => {
  it("出発点があれば、1 軒目はその名前から測る", () => {
    const route = planRoute([shopAt("a", 1), shopAt("b", 5)], ORIGIN);
    expect(describeLeg(route.legs[0], 0, ORIGIN)).toBe("横浜駅から 1.0km");
  });

  it("出発点が無ければ、1 軒目は起点だと書く", () => {
    // 距離が無いのに「0m」や空欄を出すと、測り忘れたように見える。
    const route = planRoute([shopAt("a", 1), shopAt("b", 5)]);
    expect(describeLeg(route.legs[0], 0)).toBe("ここから出発");
  });

  it("2 軒目からは、前の店から測る", () => {
    const route = planRoute([shopAt("a", 1), shopAt("b", 5)], ORIGIN);
    expect(describeLeg(route.legs[1], 1, ORIGIN)).toBe("1 軒目から 4.0km");
  });

  it("出発点に名前が無ければ座標で名乗る", () => {
    // 「から 350m」のように、どこからか分からない文にしない。
    const bare: Origin = { lat: 35.4657, lon: 139.622, source: "place" };
    const route = planRoute([shopAt("a", 1)], bare);
    expect(describeLeg(route.legs[0], 0, bare)).toBe("35.4657, 139.6220から 1.0km");
  });
});
