import { CONFIDENCE, TASTES, type DecideInfo, type Shop, type TasteKey } from "./types";

const TASTE_REFERENCE_DESCRIPTION = "既知ブランドからの参考値で、実食に基づくものではありません";
export const TASTE_REFERENCE_NOTE = `味の傾向は${TASTE_REFERENCE_DESCRIPTION}。`;
const TASTE_UNKNOWN_NOTE = "味の傾向が未判定の店舗は推測で補わないでください。";

/** 個別店舗でも同じ但し書きを使う。 */
export function describeTaste(taste: TasteKey): string {
  return taste === "unknown"
    ? "未判定（推測で補わないこと）"
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

/**
 * 画面の下に常に出す注記。推定であること・直線距離であることは短くしても残す。
 * 判定（地図の記載と既知ブランド）と味（既知ブランドの参考値）は出どころが違うので、
 * まとめて「地図の記載から」と書かない。
 *
 * 判定の段階ごとの定義まで全部並べると長くなり、読まれずに不安だけが残る
 * （2026-10-04 に本番で確認）。定義は DATA_DEFINITIONS に分け、開いて読めるようにする。
 */
export const DATA_FOOTNOTE = `店舗データは OpenStreetMap（ODbL）由来です。家系の判定は地図の記載と既知のブランドからの推定です。${TASTE_REFERENCE_NOTE}距離は直線距離です。営業時間は変わることがあるため、訪問前にご確認ください。`;

/** 判定の段階と味の傾向の定義。個別のバッジと同じ定義を読む。 */
export const DATA_DEFINITIONS = [
  ...Object.values(CONFIDENCE).map(({ label, description }) => `「${label}」は${description}。`),
  TASTE_REFERENCE_NOTE,
  `「${TASTES.unknown.label}」は${TASTES.unknown.description}です。`,
];
