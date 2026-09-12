/**
 * OSM の要素を家系ラーメン店として判定・正規化するロジック。
 *
 * データ生成（build-dataset.mjs）とテストの両方から使うため、
 * ファイル入出力を持たない純粋な関数として切り出している。
 */

/** 家系として確実に扱うブランド。値は味の傾向キー。 */
export const KNOWN_BRANDS = {
  吉村家: "rich",
  杉田家: "rich",
  厚木家: "rich",
  はじめ家: "rich",
  たかさご家: "rich",
  環2家: "rich",
  環二家: "rich",
  王道家: "rich",
  武道家: "rich",
  上越家: "rich",
  六角家: "rich",
  本牧家: "rich",
  壱六家: "creamy",
  壱八家: "creamy",
  松壱家: "creamy",
  魂心家: "creamy",
  寿々㐂家: "creamy",
  近藤家: "creamy",
  町田商店: "chain",
  町田家: "chain",
  壱角家: "chain",
  せい家: "chain",
  武蔵家: "chain",
  春樹: "chain",
  山岡家: "chain",
};

/** 家で終わるが家系ではない、または飲食店ですらないもの。 */
export const EXCLUDE = [
  "杉田家住宅",
  "本家第一旭",
  "幸楽苑",
  "博多風龍",
  "長浜家",
  "古久家",
  "無敵家",
  "一蘭",
  "花月嵐",
  "日高屋",
  "ばんから",
  "来来亭",
];

/**
 * 店名に入っていれば家系ではないと判断するジャンル語。
 * 「〜家」で終わるだけの likely 判定にのみ効かせる（confirmed は落とさない）。
 */
export const OTHER_GENRES = [
  "そば",
  "蕎麦",
  "うどん",
  "担担",
  "担々",
  "タンタン",
  "坦々",
  "坦坦",
  "煮干",
  "にぼし",
  "ニボシ",
  "味噌",
  "みそ",
  "二郎",
  "まぜそば",
  "油そば",
  "台湾",
  "つけ麺専門",
  "餃子",
  "定食",
  "居酒屋",
  "食堂",
];

/** 支店名やブランドの揺れを吸収して、既知ブランドを 1 つ返す。 */
export function matchBrand(text) {
  return Object.keys(KNOWN_BRANDS).find((b) => text.includes(b));
}

/**
 * OSM のタグから家系判定を行う。
 *
 * @returns "confirmed" | "likely" | null（null は家系ではないと判断したもの）
 */
export function classify(tags) {
  const name = tags["name:ja"] || tags.name || tags.brand;
  if (!name) return null;

  const haystack = [name, tags.brand, tags.operator].filter(Boolean).join(" ");
  if (EXCLUDE.some((x) => haystack.includes(x))) return null;

  if (/家系|横浜家系|よこはま家系/.test(haystack) || matchBrand(haystack)) {
    return "confirmed";
  }

  const isRamen = /ramen/.test(tags.cuisine ?? "");
  // 支店名や括弧書きを落としてから「〜家」で終わるかを見る
  const core = name.replace(/[\s（(].*$/, "").replace(/(店|支店|本店)$/, "");
  if (isRamen && core.endsWith("家") && !OTHER_GENRES.some((g) => name.includes(g))) {
    return "likely";
  }

  return null;
}

/** addr:* タグから表示用の住所を組み立てる。city は別フィールドなので含めない。 */
export function buildAddress(tags) {
  const city = tags["addr:city"] || undefined;
  const address = [
    tags["addr:suburb"],
    tags["addr:quarter"],
    tags["addr:neighbourhood"],
    tags["addr:block_number"],
    tags["addr:housenumber"],
  ]
    .filter(Boolean)
    .join("")
    // suburb が「横浜市西区」のように city を含むことがあるので取り除く
    .replace(new RegExp(`^${city ?? "\\u0000"}`), "");

  return { city, address: address || undefined };
}

/** OSM 要素 1 件を Shop に変換する。家系でなければ null。 */
export function toShop(el) {
  const t = el.tags ?? {};
  const confidence = classify(t);
  if (!confidence) return null;

  const name = t["name:ja"] || t.name || t.brand;
  const knownBrand = matchBrand([name, t.brand, t.operator].filter(Boolean).join(" "));
  const { city, address } = buildAddress(t);

  return {
    id: `${el.osmType}/${el.osmId}`,
    name,
    nameEn: t["name:en"] || undefined,
    brand: t.brand || knownBrand || undefined,
    taste: knownBrand ? KNOWN_BRANDS[knownBrand] : "unknown",
    confidence,
    prefecture: el.prefecture,
    city,
    address,
    lat: Number(el.lat.toFixed(6)),
    lon: Number(el.lon.toFixed(6)),
    openingHours: t.opening_hours || undefined,
    website: t.website || t.url || undefined,
    phone: t.phone || t["contact:phone"] || undefined,
    osmUrl: `https://www.openstreetmap.org/${el.osmType}/${el.osmId}`,
  };
}
