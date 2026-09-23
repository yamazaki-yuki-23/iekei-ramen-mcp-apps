/**
 * 「まわる店」の順路。
 *
 * 決めたあと、ユーザーは必ずアプリを出て地図アプリを開く。そこが手作業の
 * ままだと体験が途切れるので、回る順番と距離までこちらで出す。
 *
 * **道のりではなく直線距離。** 経路探索のデータは持っていないので、
 * 言えるのは「この順に回ると直線の合計が一番短い」までで、実際の道のりは
 * 必ずこれより長い。徒歩◯分に換算しない。曲がる道も坂も知らないまま
 * 時間を出すと、間に合うかどうかの判断材料に化けてしまう。
 */
import { distanceKm, formatDistance, originLabel } from "./geo";
import type { Origin, Shop } from "./types";

/**
 * 「まわる店」に入れられる上限。
 *
 * 家系を 3 杯続けるのが現実的な上限で、それ以上は「決められない一覧」に
 * 戻ってしまう。総当たりの手数（3! = 6 通り）が一瞬で終わる範囲でもある。
 */
export const MAX_STOPS = 3;

export interface RouteLeg {
  shop: Shop;
  /** 1 つ前からの直線距離 (km)。出発点が無いときの 1 軒目だけ入らない。 */
  fromPreviousKm?: number;
}

export interface Route {
  legs: RouteLeg[];
  /** 各区間の合計。表示する数字を足したものと必ず一致する。 */
  totalKm: number;
  /** 基準地点から始まる順路か。false なら 1 軒目が出発点。 */
  fromOrigin: boolean;
}

/**
 * 画面に出る桁まで丸めた距離。
 *
 * **区間はこの値で持ち、合計もこの値から出す。** 内部の細かい値で足すと、
 * 画面の足し算が合わなくなる（1.042km が 2 区間だと「1.0km + 1.0km」と出るのに
 * 合計が「2.1km」になっていた）。`formatDistance` が m と km で桁を変えるので、
 * 丸め方もそれに合わせる。
 *
 * 合計が実際よりわずかに粗くなるが、距離はもともと直線の目安なので、
 * 数十 m の精度より画面の整合を優先する。
 */
const displayKm = (km: number): number =>
  km < 1 ? Math.round(km * 1000) / 1000 : Number(km.toFixed(1));

/** 浮動小数の端数を落とす（1.1 + 1.1 が 2.2000000000000002 になるため）。 */
const round = (km: number): number => Number(km.toFixed(3));

/**
 * 全順列。MAX_STOPS が小さいので総当たりで最短を選ぶ。
 *
 * 近い方から貪欲に選ぶと最短にならないことがある（1 軒目を間違えると
 * 戻る形になる）。数軒なら数え上げた方が速いし、答えも一意に決まる。
 */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
}

/** 1 つ前（最初は出発点）。出発点が無いときの 1 軒目だけ相手がいない。 */
const previousOf = (order: Shop[], i: number, origin?: Origin) => (i === 0 ? origin : order[i - 1]);

/**
 * 並びの良し悪しを測る、丸めない合計。
 *
 * **選ぶときは生の距離で比べること。** 表示用に丸めた値で比べると、1km を
 * 超える区間では差が桁に埋もれて同点になり、本当はもっと短い並びがあるのに
 * 入力順が残る。短い順に回れるという約束が崩れ、地図アプリにもその並びで渡る。
 */
function exactTotal(order: Shop[], origin?: Origin): number {
  return order.reduce((sum, shop, i) => {
    const prev = previousOf(order, i, origin);
    return prev ? sum + distanceKm(prev.lat, prev.lon, shop.lat, shop.lon) : sum;
  }, 0);
}

/** 画面に出す形。ここで初めて桁を落とす。 */
function legsOf(order: Shop[], origin?: Origin): RouteLeg[] {
  return order.map((shop, i) => {
    const prev = previousOf(order, i, origin);
    if (!prev) return { shop };
    return { shop, fromPreviousKm: displayKm(distanceKm(prev.lat, prev.lon, shop.lat, shop.lon)) };
  });
}

const totalOf = (legs: RouteLeg[]): number =>
  round(legs.reduce((sum, leg) => sum + (leg.fromPreviousKm ?? 0), 0));

/**
 * 回る順番を決める。
 *
 * 基準地点があるならそこから出発する。無いときは出発する店も含めて選ぶ
 * （どこから始めても合計が最短になる並びを取る）。
 *
 * 同点のときは入力の順を残す。乱数も時刻も使わないので、同じ条件なら
 * 毎回同じ順路になり、テストできる。
 */
export function planRoute(shops: Shop[], origin?: Origin): Route {
  const stops = shops.slice(0, MAX_STOPS);
  const fromOrigin = origin !== undefined;
  if (stops.length === 0) return { legs: [], totalKm: 0, fromOrigin };

  let best = stops;
  let bestTotal = exactTotal(stops, origin);
  for (const order of permutations(stops)) {
    const total = exactTotal(order, origin);
    // 厳密に短いときだけ差し替える。同点は先に見たもの＝入力順が残る。
    if (total < bestTotal) {
      best = order;
      bestTotal = total;
    }
  }
  // 並びが決まってから桁を落とす。合計は画面に出る区間の数字から出す。
  const legs = legsOf(best, origin);
  return { legs, totalKm: totalOf(legs), fromOrigin };
}

/**
 * その区間をどこから来たか。
 *
 * 「何軒目から」を出さないと、合計だけ見せられて内訳が追えない。
 * 出発点があるかどうかで 1 軒目の言い方が変わるので、ここで 1 本にまとめる。
 */
export function describeLeg(leg: RouteLeg, index: number, origin?: Origin): string {
  // 基準地点が無いときの 1 軒目。ここが起点になるので、来た距離が無い。
  if (leg.fromPreviousKm === undefined) return "ここから出発";
  const from = index === 0 && origin ? originLabel(origin) : `${index} 軒目`;
  return `${from}から ${formatDistance(leg.fromPreviousKm)}`;
}

const coord = (p: { lat: number; lon: number }): string => `${p.lat},${p.lon}`;

/**
 * Google マップの経路 URL。
 *
 * 基準地点が無いときは origin を省く。省くと Google 側が現在地を出発点に
 * するので、こちらで勝手に 1 軒目を出発点に仕立てるより実態に合う。
 */
export function googleMapsRouteUrl(route: Route, origin?: Origin): string {
  const stops = route.legs.map((leg) => leg.shop);
  if (stops.length === 0) return "";
  const params = new URLSearchParams({
    api: "1",
    destination: coord(stops[stops.length - 1]),
    travelmode: "walking",
  });
  if (origin) params.set("origin", coord(origin));
  const waypoints = stops.slice(0, -1);
  if (waypoints.length > 0) params.set("waypoints", waypoints.map(coord).join("|"));
  return `https://www.google.com/maps/dir/?${params}`;
}
