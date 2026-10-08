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
 * 畳んだ「データについて」の中に置く出どころの説明（#152）。推定と直線距離は
 * 結果のすぐ下の但し書き（resultCaveat）で 1 回だけ言うので、ここは開いて読む人向け。
 * 判定（地図の記載と既知ブランド）と味（既知ブランドの参考値）は出どころが違うので、
 * まとめて「地図の記載から」と書かない。
 *
 * 判定の段階ごとの定義まで全部並べると長くなり、読まれずに不安だけが残る
 * （2026-10-04 に本番で確認）。定義は DATA_DEFINITIONS に分け、開いて読めるようにする。
 */
export const DATA_FOOTNOTE = `店舗データは OpenStreetMap（ODbL）由来です。家系の判定は地図の記載と既知のブランドからの推定です。${TASTE_REFERENCE_NOTE}距離は直線距離です。営業時間は変わることがあるため、訪問前にご確認ください。`;

/** 画面の下に常に見せる出典（ODbL の表示義務）。説明は「データについて」の中。 */
export const DATA_CREDIT = "店舗データ: © OpenStreetMap contributors（ODbL）";

/**
 * 結果のすぐ下に 1 回だけ出す但し書き（#152）。推定であること・並びがおすすめ度では
 * ないこと・直線距離であること・誤りの報告の道を、この 1 段落にまとめる。券売機の下・
 * 画面の下・説明の中に同じことを重ねると、1 画面に 4 回出て読まれなくなった。
 * 判定の段階は画面に出さないので（#144）、家系でない店が混ざりうることもここで言う。
 * 報告の口が無いホスト（会話の中）では Web 版の報告へ案内する。
 */
export function resultCaveat(reports: boolean): string {
  // 判定（地図の記載と既知ブランド）と味（既知ブランドの参考値）は出どころが違うので分けて書く。
  const note =
    "家系かどうかは推定、味の傾向は参考値で、並び順はおすすめ度ではありません。距離は直線距離です。";
  return reports
    ? `${note}違う店があれば、店を開いて「店舗情報を報告する」から教えてください。`
    : `${note}違う店があれば、Web 版（iekeiramen.com）で店を開き「店舗情報を報告する」から教えてください。`;
}

/** 味の傾向の定義。参考値の但し書きは DATA_FOOTNOTE が持つので、ここで繰り返さない。 */
export const DATA_DEFINITIONS = [
  `「${TASTES.unknown.label}」は${TASTES.unknown.description}です。`,
];
