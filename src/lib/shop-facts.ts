import { TASTES, type Shop } from "./types";

type Countable = Pick<Shop, "city" | "brand">;

/** 市区町村ごとの、ブランドの軒数。キーは「市区町村|ブランド」。 */
export function brandCounts(shops: readonly Countable[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const shop of shops) {
    if (!shop.brand || !shop.city) continue;
    const key = `${shop.city}|${shop.brand}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * 営業時間の記載の、開店のいちばん早い時刻（時）。読めなければ null。
 * **0 時に始まる区間は開店に数えない。** 「Su 00:00-03:00,11:00-23:00」の 0〜3 時は、前の晩の営業の
 * 続き（日付をまたいだ分）で、朝に開けているわけではない（実データで 5 軒が「朝 0 時から」になっていた）。
 */
function earliestOpening(raw: string): number | null {
  const hours = [...raw.matchAll(/(\d{1,2}):\d{2}-/g)]
    .map((m) => Number(m[1]))
    .filter((h) => h > 0);
  return hours.length > 0 ? Math.min(...hours) : null;
}

/**
 * 家系スワイプのレア札の理由（#166）。**持っている事実だけ**で決める（乱数も、おいしさ・人気も使わない）。
 *
 * - 味の傾向が直系・濃厚（既知のブランドからの参考値）
 * - 営業時間の記載が 24 時間、または朝 5 時までに開く
 * - その市区町村で 1 軒だけのブランド
 *
 * 当たらなければ空の配列。並び順は変えない（近い順のまま、見せ方だけ変える）。
 */
export function shopFacts(shop: Shop, counts: ReadonlyMap<string, number>): string[] {
  const facts: string[] = [];
  if (shop.taste === "rich") facts.push(TASTES.rich.label);
  const hours = shop.openingHours?.trim() ?? "";
  if (hours === "24/7") facts.push("24 時間営業の記載");
  else {
    const earliest = earliestOpening(hours);
    if (earliest !== null && earliest <= 5) facts.push(`朝 ${earliest} 時から`);
  }
  if (shop.brand && shop.city && counts.get(`${shop.city}|${shop.brand}`) === 1)
    facts.push(`${shop.city}で 1 軒だけの${shop.brand}`);
  return facts;
}

/**
 * 画面いっぱいに叩きつける判子の短い言い方。札には理由を全部書くので、判子は一目で読める長さにする。
 * 味の傾向は「直系・濃厚」のまま縮めない。データは味の分類（参考値）で、系譜（直系かどうか）は持っていない。
 */
export function factStamp(fact: string): string {
  if (fact.startsWith("24 時間")) return "24 時間";
  if (fact.includes("1 軒だけ")) return "1 軒だけ";
  return fact;
}
