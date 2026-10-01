/**
 * 使われているかを数える（Workers Analytics Engine）。
 *
 * **書くのは「どの tool が呼ばれたか」と「サインインしていたか」だけ。**
 * IP・生の `sub`・訪問者の id・引数（検索した地名・座標・都道府県・店）は
 * 書かない。地名や座標は、その人の居場所に近い。スタンプは「押した／外した」
 * だけを書き、どの店かは書かない（店と時刻が並ぶと、通う店が分かる）。
 *
 * 書き込みは応答を待たせない（`writeDataPoint` は同期で返る）。**書けなくても
 * 検索は止めない**——無料枠（1 日 10 万件）を超えたときの挙動はドキュメントに
 * 無いので、投げても握りつぶす。
 */

/**
 * 数える tool。**ここに無い名前は書かない。** 本文の tool 名は呼ぶ側が自由に
 * 書けるので、そのまま書くと任意の文字列（地名など）まで計測に入りうる。
 * サーバーの tool と食い違わないことは tests/usage.test.ts が見張る。
 */
export const COUNTED_TOOLS = [
  "search-iekei-ramen",
  "find-nearby-iekei-ramen",
  "show-iekei-ramen-map",
  "decide-iekei-ramen",
  "geocode-place",
  "stamp-iekei-ramen",
  "show-visited-iekei-ramen",
  "forget-my-iekei-ramen-visits",
] as const;

type CountedTool = (typeof COUNTED_TOOLS)[number];

/** 1 回の呼び出しで書くもの。型の上でも、個人を特定できる値を持てない。 */
export interface UsageEvent {
  tool: CountedTool;
  signedIn: boolean;
  /** スタンプのときだけ。押したか外したか。 */
  stamp?: "visited" | "unvisited";
}

const isCounted = (name: string): name is CountedTool =>
  (COUNTED_TOOLS as readonly string[]).includes(name);

/**
 * 受け付けた 1 回の呼び出しから、書くものを作る。数える tool でなければ null。
 * 引数から読むのはスタンプの向きだけで、ほかは捨てる。
 */
export function usageEvent(name: string, args: unknown, signedIn: boolean): UsageEvent | null {
  if (!isCounted(name)) return null;
  const event: UsageEvent = { tool: name, signedIn };
  if (name === "stamp-iekei-ramen") {
    const visited = (args as { visited?: unknown } | undefined)?.visited;
    event.stamp = visited === false ? "unvisited" : "visited";
  }
  return event;
}

/**
 * Analytics Engine に書く形。並びは週ごとの集計（scripts/usage.mjs）と揃えてある。
 *
 * | 欄 | 中身 |
 * | --- | --- |
 * | index1 | tool 名（同じ tool の件数をまとめて数えるため） |
 * | blob1 | tool 名 |
 * | blob2 | `member` / `anonymous` |
 * | blob3 | スタンプのときだけ `visited` / `unvisited`（ほかは空） |
 * | double1 | 1 |
 */
export function toDataPoint(event: UsageEvent): AnalyticsEngineDataPoint {
  return {
    indexes: [event.tool],
    blobs: [event.tool, event.signedIn ? "member" : "anonymous", event.stamp ?? ""],
    doubles: [1],
  };
}

/** 書く。**書けなくても投げない**（計測のために検索を止めない）。 */
export function recordUsage(
  dataset: AnalyticsEngineDataset | undefined,
  event: UsageEvent | null,
): void {
  if (!dataset || !event) return;
  try {
    dataset.writeDataPoint(toDataPoint(event));
  } catch {
    // 無料枠を超えた・一時的に書けないなど。数え漏れより、検索を止める方が悪い。
  }
}
