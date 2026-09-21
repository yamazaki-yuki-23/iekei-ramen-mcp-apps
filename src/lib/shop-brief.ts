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
