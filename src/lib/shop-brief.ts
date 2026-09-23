import { formatDistance } from "./geo";
import { CONFIDENCE, TASTES, type Shop } from "./types";

/**
 * 選択した店をモデルに渡すためのテキスト。
 *
 * 判定も味の傾向も推定でしかないので、事実と同じ書き方にしない。
 * モデルは渡された文をそのまま断定して話すため、但し書きを本文に含めている。
 * UI のバッジに付けている注記と同じことを、モデル向けにも書いているだけ。
 */
export function describeShop(shop: Shop): string {
  const lines = [
    "ユーザーが UI で選択した店舗:",
    `店名: ${shop.name}`,
    `所在地: ${[shop.prefecture, shop.city, shop.address].filter(Boolean).join(" ")}`,
    `家系判定: ${CONFIDENCE[shop.confidence].label}（${CONFIDENCE[shop.confidence].description}）`,
  ];

  if (shop.brand) lines.push(`ブランド: ${shop.brand}`);

  lines.push(
    shop.taste === "unknown"
      ? "味の傾向: 情報なし（推測で補わないこと）"
      : `味の傾向: ${TASTES[shop.taste].label}（既知ブランドからの参考値。実食に基づくものではない）`,
  );

  if (shop.openingHours) lines.push(`営業時間: ${shop.openingHours}（OSM 由来。変わることがある）`);
  if (shop.phone) lines.push(`電話: ${shop.phone}`);
  if (shop.website) lines.push(`サイト: ${shop.website}`);
  if (shop.distanceKm !== undefined) {
    lines.push(`基準地点からの直線距離: ${formatDistance(shop.distanceKm)}`);
  }
  lines.push(`OSM: ${shop.osmUrl}`);
  lines.push(
    "出典は OpenStreetMap で、味・混雑・評判のデータは持っていない。" +
      "知らないことは、このアプリのデータには無いと答えること。",
  );

  return lines.join("\n");
}

/** 「この店について聞く」で会話に流す一文。 */
function askAboutShopText(shop: Shop): string {
  const where = [shop.prefecture, shop.city].filter(Boolean).join("");
  return `UI で選択した「${shop.name}」（${where}）について教えて。`;
}

/**
 * 「この店について聞く」で送る本文。
 *
 * 詳細が model context として届いていれば短い一文で足りる。届いていないときに
 * 店名だけを送ると、モデルは但し書きを知らないまま自分の知識で答えてしまうので、
 * この一通に詳細を同梱する。
 */
export function askMessageText(shop: Shop, contextDelivered: boolean): string {
  const ask = askAboutShopText(shop);
  return contextDelivered ? ask : `${ask}\n\n${describeShop(shop)}`;
}

/**
 * 「この 3 軒から選ぶ」で会話に流す本文。
 *
 * UI から tool を呼んだ結果は ontoolresult が来ないので、サーバーが返した
 * 依頼文はモデルに届いていない。届いていない前提で、候補と但し書きと依頼を
 * この一通に入れる。
 *
 * 1 軒ぶんの詳細（describeShop）を 3 つ並べると長すぎて依頼が埋もれるので、
 * ここでは 1 行ずつに畳み、但し書きは末尾にまとめて 1 度だけ置く。
 *
 * cleared は「開いていた店をモデル側から消せたか」。消せていないと、
 * 「この店を選んだ」と「この中から選んで」が同時に届き、答えが開いていた店に
 * 引きずられる。消せなかったときは、文面の側で明示的に打ち消す。
 * 既定値は置かない。呼び出し側が結果を見ずに送るのを、型で止めるため。
 */
export function decideMessageText(shops: Shop[], basis: string, cleared: boolean): string {
  const lines = shops.map((s, i) => {
    const where = [s.prefecture, s.city, s.address].filter(Boolean).join(" ");
    const dist = s.distanceKm !== undefined ? ` / ${formatDistance(s.distanceKm)}` : "";
    const conf = s.confidence === "confirmed" ? "" : ` / ${CONFIDENCE[s.confidence].label}`;
    const taste =
      s.taste === "unknown" ? "味の傾向は情報なし" : `味の傾向 ${TASTES[s.taste].label}`;
    const hours = s.openingHours ? `営業 ${s.openingHours}` : "営業時間はデータなし";
    return `${i + 1}. ${s.name}（${taste}${conf}${dist}）／ ${where} ／ ${hours}`;
  });

  // 軒数は実際の件数から出す。最終巡は 3 軒に満たないことがあり、
  // 1 軒しか無いのに「選ばなかった 2 軒」と頼むと、モデルが無い店を作る。
  const n = shops.length;
  const head =
    n === 1
      ? "UI で候補をこの 1 軒に絞りました。どういう人に向くかを 2〜3 文で教えてください。"
      : `UI でこの ${n} 軒まで絞りました。この中から 1 軒を選んで、理由を 2〜3 文で教えてください。`;
  const alternatives =
    n === 1
      ? []
      : [
          `選ばなかった ${n - 1} 軒についても、どういう人ならそちらが向くかを一言ずつ添えてください。`,
        ];

  /*
   * updateModelContext を 2 度とも断られたときだけ出る。送らない選択もあるが、
   * それでは押した操作が何も進まない。モデルへの指示で上書きする方を採る。
   */
  const stale = cleared
    ? []
    : [
        "直前に UI で選んでいた店の情報が、この会話に残っているかもしれません。それは取り消したものなので無視して、上の候補だけから選んでください。",
      ];

  return [
    head,
    ...stale,
    basis,
    "",
    lines.join("\n"),
    "",
    "理由に使っていいのは上の情報だけです（家系判定の段階・味の傾向・距離・営業時間）。",
    "味の濃さ・混雑・行列・評判・口コミは、このアプリのデータには含まれていません。",
    "推測で補わず、分からないことは分からないと言ってください。味の傾向は既知ブランドからの",
    "参考値で、実食に基づくものではありません。",
    ...alternatives,
  ].join("\n");
}
