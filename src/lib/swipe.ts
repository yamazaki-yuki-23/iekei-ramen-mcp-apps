import { formatDistance } from "./geo";
import type { Shop } from "./types";

/**
 * 家系マッチ（#166）の、画面に依らない決まり。問いかけの文・出口・FEVER のたまり方。
 * 問いかけは**持っている事実だけ**で作る（距離・見た数・残りの数・操作の回数・注文の一般論）。
 * 「人気」「おいしい」「営業中」「当たり」は使わない（tests/swipe.test.ts で確かめる）。
 */

/** 1 回に出す範囲（近い順の何軒ずつ）。見終わったら区切り、無限には続けない。 */
export const SWIPE_STEP = 20;
/** 残りがこの枚数になったら、次の範囲を先に取っておく。 */
export const PREFETCH_AT = 5;
/** FEVER の長さ。 */
export const FEVER_MS = 10_000;

export type SwipeDir = "want" | "pass";

export interface Ask {
  text: string;
  sub?: string;
  /** 味の傾向を変える選択肢を出すか（パスが続いたとき）。 */
  offerTaste?: boolean;
}

interface AskState {
  shop: Shop;
  /** この札が何枚目か（1 始まり）。 */
  index: number;
  /** これまでに払った枚数。 */
  seen: number;
  passStreak: number;
  /** この範囲で、この札より後に残っている枚数。 */
  left: number;
  /** この札より後で、直線 1km 以内の枚数。 */
  nearLeft: number;
}

/** 札が出たときの問いかけ。強い順に 1 つだけ選ぶ。 */
export function askFor({ shop, index, seen, passStreak, left, nearLeft }: AskState): Ask {
  if (passStreak >= 3)
    return { text: `${passStreak} 連続パス。味の傾向を変えてみる？`, offerTaste: true };
  const km = shop.distanceKm;
  if (km !== undefined && km < 1) {
    return {
      text: `直線 ${formatDistance(km)}。行ける距離？`,
      sub: nearLeft > 0 ? `この先 1km 以内に、あと ${nearLeft} 軒` : undefined,
    };
  }
  const sub = `この範囲に、あと ${left} 軒`;
  if (seen > 0 && seen % 5 === 0) return { text: `知らない家系、${index} 軒目。`, sub };
  return { text: "ここ、知ってた？", sub };
}

/** 見終わったときの問いかけ。 */
export function askAtEnd(count: number): Ask {
  return {
    text: "この辺りの家系は全部見た。範囲を広げる？",
    sub: `近い順に ${count} 軒を見ました`,
  };
}

/** 続きの取得に失敗して見終わったとき。「全部見た」とは言わない。 */
export const LOAD_FAILED_ASK: Ask = {
  text: "続きを読み込めませんでした。",
  sub: "もう一度読み込むと、続きから見られます。",
};

/** 「今日はここ」の直後。注文カンペの一般論だけ（その店の味は言わない）。 */
export const DECIDED_ASK: Ask = {
  text: "決まり。",
  sub: "初めてなら、麺の硬さも味の濃さも「普通」で。",
};

/** いまの画面に出す問いかけ。強い順に 1 つ。 */
export function askForScreen(state: {
  view: "cards" | "today" | "wants";
  ended: boolean;
  failedEnd: boolean;
  current?: Shop;
  pos: number;
  seen: number;
  passStreak: number;
  /** 今の札より後ろの札。 */
  rest: Shop[];
  total: number;
}): Ask | null {
  const { view, ended, failedEnd, current, pos, seen, passStreak, rest, total } = state;
  if (view === "wants") return null;
  if (view === "today") return DECIDED_ASK;
  // 続きの取得に失敗したときに「全部見た」と言わない（下の紙と食い違う）。
  if (ended) return failedEnd ? LOAD_FAILED_ASK : askAtEnd(total);
  if (!current) return null;
  return askFor({
    shop: current,
    index: pos + 1,
    seen,
    passStreak,
    left: rest.length,
    nearLeft: rest.filter((s) => (s.distanceKm ?? 99) <= 1).length,
  });
}

/**
 * 「行きたい」の数で出口を変える。1 軒なら地図アプリ、2〜3 軒なら「まわる店」、
 * 4 軒以上なら 3 軒まで選ぶ。3 軒そろえる必要は無い（1 軒で十分な人を締め出さない）。
 */
export function exitFor(count: number): "none" | "map" | "route" | "pick" {
  if (count === 0) return "none";
  if (count === 1) return "map";
  return count <= 3 ? "route" : "pick";
}

/**
 * FEVER のゲージのたまり方（100 で満タン）。払う手数へのご褒美で、店の良し悪しは表さない。
 * 行きたいとレア札で多めにたまる。
 */
export function chargeFor(dir: SwipeDir, rare: boolean): number {
  return dir === "want" ? 14 + (rare ? 16 : 0) : 6;
}

/** シェアの文。店の評価は書かない（決めた事実と場所だけ）。 */
export function shareText(names: string[]): string {
  return names.length === 1
    ? `今日は「${names[0]}」に行く。家系マッチで決めた。`
    : `今日は ${names.map((n) => `「${n}」`).join("→")} をまわる。家系マッチで決めた。`;
}
