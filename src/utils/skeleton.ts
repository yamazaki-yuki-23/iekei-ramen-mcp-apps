import type { SearchMode, Shop } from "../types";

/**
 * 結果の領域の見え方（#214）。
 * - live: 結果をそのまま出す
 * - hold: 同じ探し方で取り直し始めてから 300ms まで。前の結果を見た目は変えずに残すが、押せない
 *   （待つ間に古い結果の店を選ばせない。#146 の「後から押したものが勝つ」を崩さない）
 * - dim: 同じ探し方で取り直している間（300ms 以降）。前の結果を薄くして残し、高さを保つ（押せない）
 * - skeleton: 違う探し方へ移る間。その探し方の形の骨組み（押せない）
 * - reserve: 呼んでから 300ms までの骨組み。場所だけ取って見せない（速く届いたときにちらつかせない）
 */
export type ResultLook = "live" | "hold" | "dim" | "skeleton" | "reserve";

/**
 * 骨組みに出す枚数。返ってくる数がいつも決まっている探し方はその数（「迷ったら」3 軒・「現在地から」5 軒。
 * 多く出すと、届いたときに余りの分だけ縮んで下が跳ねる）。数が決まらない一覧は最初の画面を埋める分。
 */
const SKELETON_COUNT: Record<SearchMode, number> = {
  decide: 3,
  form: 8,
  nearby: 5,
  map: 8,
  visited: 8,
};

/**
 * 骨組みに渡す仮の店。本物の部品にそのまま渡して描き、文字を透明な帯にする（CSS の .skeleton）。
 * 寸法を決め打ちせず、本物と同じ部品・同じ行数で描くので、届いて入れ替わっても配置が変わらない。
 * 値は多くの店と同じ行数になるもの（店名 1 行・住所 1 行・営業時間あり）。
 */
export function skeletonShops(mode: SearchMode, known?: number): Shop[] {
  // 「行った店」は記録の数が先に分かっている（payload.visited）。0・1 件の人に 8 枚出すと、
  // 届いたときに縮んで下が跳ねる（#214 のレビュー）。
  const length = known === undefined ? SKELETON_COUNT[mode] : Math.min(known, SKELETON_COUNT[mode]);
  return Array.from({ length }, (_, i) => ({
    id: `skeleton-${i}`,
    name: "家系ラーメン",
    brand: "家系",
    taste: "rich",
    confidence: "confirmed",
    prefecture: "神奈川県",
    city: "横浜市",
    address: "西区高島",
    lat: 0,
    lon: 0,
    openingHours: "11:00-22:00",
    osmUrl: "",
    distanceKm: 1,
  }));
}

/**
 * 件数の札の場所取り（#214）。結果が届いた瞬間に札が差し込まれて約 20px ずれるのを防ぐ。
 * 札は見出しの横に入りきらないと次の行に回るので、本物と同じくらいの長さの文で場所を取る。
 * 「迷ったら」の札（並べた根拠）は短い。
 */
export function countPlaceholder(mode: SearchMode): string {
  // 文字そのものは置かない（見えない札の文字を、本物の札と取り違えさせない）。全角の空白で同じ幅にする。
  return "\u3000".repeat(PLACEHOLDER_WIDTH[mode]);
}

/**
 * 件数の札の幅（全角の文字数）。本物の札と同じくらいにする。「行った店」の札は「N 軒」と短いので、
 * 長い文の幅で取ると、スマホ幅では次の行に回って、届いたときに 1 行分縮んだ。
 */
const PLACEHOLDER_WIDTH: Record<SearchMode, number> = {
  decide: 3,
  visited: 3,
  form: 19,
  nearby: 19,
  map: 19,
};

/**
 * 結果の領域の見え方を決める（#214）。waiting は応答を待っていて結果がまだ揃っていない間、
 * keep はその間も前の結果がこの探し方のもの（同じ探し方で取り直している）か、slow は 300ms を過ぎたか。
 */
export function resultLook(waiting: boolean, keep: boolean, slow: boolean): ResultLook {
  if (!waiting) return "live";
  if (keep) return slow ? "dim" : "hold";
  return slow ? "skeleton" : "reserve";
}

/**
 * 骨組みの「迷ったら」の見出しと札（Web、#214）。本物と同じくらいの長さの仮の文にする（骨組みの中なので
 * 透明な帯になる）。見出しを「迷ったら」のままにすると、本物（「迷ったらこの 3 軒（〇〇付近）」と「近い順」の札）
 * より約 47px 低く、届いたときに下の券売機や「見つからないときは」が押し下げられた。
 */
export function placeholderTitle(
  title: { heading: string; tag: string | null } | undefined,
  look: ResultLook,
) {
  if (!title || (look !== "skeleton" && look !== "reserve")) return title;
  return { heading: "迷ったらこの 3 軒（さいたま市付近）", tag: "近い順" };
}
