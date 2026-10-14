import { formatDistance } from "../../src/utils/geo.ts";
import { dataCaveats } from "../../src/utils/data-caveats.ts";
import { openingHoursLabel } from "../../src/utils/opening-hours.ts";
import { scopeLabel } from "../../src/utils/scope.ts";
import { CONFIDENCE, TASTES } from "../../src/utils/labels";
import type { Bounds, DecideInfo, Shop } from "../../src/types";

/** LLM 向けのテキスト要約。UI を描画しないホストではこれだけが返る。 */
export function summarize(shops: Shop[], heading: string, withDistance = false): string {
  if (shops.length === 0) return `${heading}\n該当する店舗は見つかりませんでした。`;
  const lines = shops.map((s, i) => {
    const dist =
      withDistance && s.distanceKm !== undefined ? ` / ${formatDistance(s.distanceKm)}` : "";
    const where = [s.prefecture, s.city, s.address].filter(Boolean).join(" ");
    // 家系と確定していない店をモデルが断定しないよう、段階を必ず添える。
    const conf = s.confidence === "confirmed" ? "" : ` / ${CONFIDENCE[s.confidence].label}`;
    return `${i + 1}. ${s.name} (${TASTES[s.taste].label}${conf}${dist})\n   ${where}${s.openingHours ? `\n   営業: ${openingHoursLabel(s.openingHours)}` : ""}`;
  });
  const notes = dataCaveats(shops);
  const caveat = notes ? `\n\n${notes}` : "";
  return `${heading}\n\n${lines.join("\n")}${caveat}`;
}

/**
 * 地図モードのテキスト。件数だけ返すと、未判定の店まで家系だと断定して
 * 伝わってしまう。一覧を出さないぶん、内訳と断り書きをここで添える。
 */
export function mapSummary(shops: Shop[], prefecture?: string, bounds?: Bounds): string {
  /*
   * 範囲で絞ったときは「全国」と名乗らない。
   *
   * **どこを見ているかはモデルに分からない。** 画面に出ている範囲だと
   * 言っておかないと、モデルが「全国で 12 件しかない」と読んで話す。
   * 語は UI の見出しと共通（[scope.ts](src/utils/scope.ts)）。
   */
  const where = scopeLabel({ prefecture, bounds });
  if (shops.length === 0) return `${where}に該当する店舗はありませんでした。`;

  const counts = shops.reduce<Partial<Record<Shop["confidence"], number>>>((acc, s) => {
    acc[s.confidence] = (acc[s.confidence] ?? 0) + 1;
    return acc;
  }, {});
  const breakdown = (["confirmed", "likely", "candidate"] as const)
    .filter((k) => counts[k])
    .map((k) => `${CONFIDENCE[k].label} ${counts[k]} 件`)
    .join(" / ");
  const notes = dataCaveats(shops);
  const caveat = notes ? `\n${notes}` : "";
  return `${where}の家系ラーメン ${shops.length} 件を地図に表示しました。\n内訳: ${breakdown}${caveat}`;
}

/**
 * 「迷ったら」のテキスト。
 *
 * **ここだけは、モデルへの依頼文を兼ねている。** 3 軒を渡して終わりにすると、
 * モデルは一覧をなぞるだけで終わり、ユーザーは結局決められない。1 軒を選んで
 * 理由を言い切らせるところまでを頼む。
 *
 * ただし、このデータには味も混雑も評判も無い。理由を自由に書かせると、
 * モデルは知識から「濃厚で人気」などと補ってしまうので、使っていい材料を
 * 明示して縛る。
 */
export function decidePrompt(shops: Shop[], basis: string, cond: string, info: DecideInfo): string {
  if (shops.length === 0) {
    return `【${cond}】条件に合う店舗が見つかりませんでした。条件を緩めて試してください。`;
  }
  const lines = shops.map((s, i) => {
    const where = [s.prefecture, s.city, s.address].filter(Boolean).join(" ");
    const dist = s.distanceKm !== undefined ? ` / ${formatDistance(s.distanceKm)}` : "";
    const conf = s.confidence === "confirmed" ? "" : ` / ${CONFIDENCE[s.confidence].label}`;
    const taste =
      s.taste === "unknown" ? TASTES.unknown.label : `味の傾向 ${TASTES[s.taste].label}`;
    return [
      `${i + 1}. ${s.name}（${taste}${conf}${dist}）`,
      `   ${where}`,
      s.openingHours
        ? `   営業: ${openingHoursLabel(s.openingHours)}（OSM 由来。変わることがある）`
        : "   営業時間: データなし",
      s.brand ? `   ブランド: ${s.brand}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");
  });

  /*
   * 軒数は必ず実際の件数から出す。最終巡は 3 軒に満たないことがあり
   * （母数が 3 の倍数でなければ必ず起きる）、1 軒しか無いのに
   * 「選ばなかった 2 軒について」と頼むと、モデルは無い店を作って答える。
   */
  const n = shops.length;
  const ask =
    n === 1
      ? ["候補はこの 1 軒だけです。どういう人に向くかを 2〜3 文で述べてください。"]
      : [
          `この ${n} 軒から 1 軒を選び、なぜそれを推すのかを 2〜3 文で述べてください。`,
          `選ばなかった ${n - 1} 軒についても、どういう人ならそちらが向くかを一言ずつ添えてください。`,
        ];

  return [
    n === 1 ? `【${cond}】候補はこの 1 軒です。` : `【${cond}】この ${n} 軒まで絞りました。`,
    basis,
    "",
    lines.join("\n"),
    "",
    ask[0],
    "理由に使っていいのは上に書いた情報だけです（判定の段階・味の傾向・距離・営業時間・ブランド）。",
    "味の濃さ・混雑・行列・評判・口コミは、このアプリのデータには含まれていません。推測で補わず、",
    "分からないことは分からないと言ってください。",
    dataCaveats(shops, info),
    ...ask.slice(1),
  ].join("\n");
}
