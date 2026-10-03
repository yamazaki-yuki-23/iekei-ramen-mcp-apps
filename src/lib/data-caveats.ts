import { CONFIDENCE, TASTES, type DecideInfo, type Shop, type TasteKey } from "./types";

const TASTE_REFERENCE_DESCRIPTION = "既知ブランドからの参考値で、実食に基づくものではありません";
export const TASTE_REFERENCE_NOTE = `味の傾向は${TASTE_REFERENCE_DESCRIPTION}。`;
export const TASTE_UNKNOWN_NOTE = "味の傾向が「情報なし」の店舗は推測で補わないでください。";

/** 個別店舗でも同じ但し書きを使う。 */
export function describeTaste(taste: TasteKey): string {
  return taste === "unknown"
    ? "情報なし（推測で補わないこと）"
    : `${TASTES[taste].label}（${TASTE_REFERENCE_DESCRIPTION}）`;
}

/** 店舗一覧の文章は経路ごとに持ち、判定と参考値の説明だけ共有する。 */
export function dataCaveats(
  shops: Shop[],
  pool?: Pick<DecideInfo, "includesLikely" | "widened">,
): string {
  const notes: string[] = [];
  for (const key of ["likely", "candidate"] as const) {
    // 旧結果の内訳が無い場合も、母集団を confirmed だけと断定しない。
    const inPool = pool && (key === "likely" ? pool.includesLikely !== false : pool.widened);
    if (inPool || shops.some((shop) => shop.confidence === key)) {
      notes.push(
        `「${CONFIDENCE[key].label}」: ${CONFIDENCE[key].description}。断定しないでください。`,
      );
    }
  }
  if (shops.some((shop) => shop.taste !== "unknown")) notes.push(TASTE_REFERENCE_NOTE);
  if (shops.some((shop) => shop.taste === "unknown")) notes.push(TASTE_UNKNOWN_NOTE);
  return notes.join("\n");
}

/** UI の全体注記も個別のバッジと同じ判定定義を読む。 */
export const DATA_FOOTNOTE = [
  "店舗データは OpenStreetMap（ODbL）由来。",
  ...Object.values(CONFIDENCE).map(({ label, description }) => `「${label}」は${description}。`),
  TASTE_REFERENCE_NOTE,
  TASTE_UNKNOWN_NOTE,
  "営業時間は変わることがあるため訪問前にご確認ください。",
].join("");
