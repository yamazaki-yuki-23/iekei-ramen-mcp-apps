/**
 * data/osm-raw.json を絞り込み・正規化して data/shops.json を生成する。
 *
 * 判定方針:
 *  - confirmed: 店名/ブランドに「家系」を含む、または既知の家系ブランドと一致
 *  - likely:    cuisine=ramen かつ店名が「家」で終わる（家系の可能性が高い）
 *  - それ以外と除外リスト該当は落とす
 */
import fs from "node:fs/promises";
import path from "node:path";

const DIR = path.join(import.meta.dirname, "..", "data");

/** 家系として確実に扱うブランド。値は味の傾向キー。 */
const KNOWN_BRANDS = {
  吉村家: "rich", 杉田家: "rich", 厚木家: "rich", はじめ家: "rich",
  たかさご家: "rich", 環2家: "rich", 環二家: "rich", 王道家: "rich",
  武道家: "rich", 上越家: "rich", 六角家: "rich", 本牧家: "rich",
  壱六家: "creamy", 壱八家: "creamy", 松壱家: "creamy", 魂心家: "creamy",
  寿々㐂家: "creamy", 近藤家: "creamy",
  町田商店: "chain", 町田家: "chain", 壱角家: "chain", せい家: "chain",
  武蔵家: "chain", 春樹: "chain", 山岡家: "chain",
};

/** 家で終わるが家系ではない、または飲食店ですらないもの。 */
const EXCLUDE = [
  "杉田家住宅", "本家第一旭", "幸楽苑", "博多風龍", "長浜家", "古久家",
  "無敵家", "一蘭", "花月嵐", "日高屋", "ばんから", "来来亭",
];

/**
 * 店名に入っていれば家系ではないと判断するジャンル語。
 * 「〜家」で終わるだけの likely 判定にのみ効かせる（confirmed は落とさない）。
 */
const OTHER_GENRES = [
  "そば", "蕎麦", "うどん", "担担", "担々", "タンタン", "坦々", "坦坦",
  "煮干", "にぼし", "ニボシ", "味噌", "みそ", "二郎", "まぜそば", "油そば",
  "台湾", "つけ麺専門", "餃子", "定食", "居酒屋", "食堂",
];

const raw = JSON.parse(await fs.readFile(path.join(DIR, "osm-raw.json"), "utf-8"));

/** 支店名やブランドの揺れを吸収して、既知ブランドを 1 つ返す。 */
function matchBrand(text) {
  return Object.keys(KNOWN_BRANDS).find((b) => text.includes(b));
}

const seen = new Set();
const shops = [];

for (const el of raw) {
  const t = el.tags;
  const name = t["name:ja"] || t.name || t.brand;
  if (!name) continue;

  const haystack = [name, t.brand, t.operator].filter(Boolean).join(" ");
  if (EXCLUDE.some((x) => haystack.includes(x))) continue;

  const isIekeiWord = /家系|横浜家系|よこはま家系/.test(haystack);
  const knownBrand = matchBrand(haystack);
  const isRamen = /ramen/.test(t.cuisine ?? "");
  // 「〜家」で終わる店名（支店名・記号を落として判定）
  const core = name.replace(/[\s（(].*$/, "").replace(/(店|支店|本店)$/, "");
  const endsWithYa = /家$/.test(core);

  let confidence;
  if (isIekeiWord || knownBrand) {
    confidence = "confirmed";
  } else if (isRamen && endsWithYa && !OTHER_GENRES.some((g) => name.includes(g))) {
    confidence = "likely";
  } else {
    continue;
  }

  // 同一店舗の重複（node と way の両方に存在する等）を名前＋座標で除去
  const key = `${name}@${el.lat.toFixed(4)},${el.lon.toFixed(4)}`;
  if (seen.has(key)) continue;
  seen.add(key);

  // city は別フィールドで持つので address には入れない（「横浜市 横浜市西区…」の重複防止）。
  const city = t["addr:city"] || undefined;
  const address = [
    t["addr:suburb"], t["addr:quarter"], t["addr:neighbourhood"],
    t["addr:block_number"], t["addr:housenumber"],
  ]
    .filter(Boolean)
    .join("")
    // suburb が「横浜市西区」のように city を含むことがあるので取り除く。
    .replace(new RegExp(`^${city ?? "\\u0000"}`), "");

  shops.push({
    id: `${el.osmType}/${el.osmId}`,
    name,
    nameEn: t["name:en"] || undefined,
    brand: t.brand || knownBrand || undefined,
    taste: knownBrand ? KNOWN_BRANDS[knownBrand] : "unknown",
    confidence,
    prefecture: el.prefecture,
    city,
    address: address || undefined,
    lat: Number(el.lat.toFixed(6)),
    lon: Number(el.lon.toFixed(6)),
    openingHours: t.opening_hours || undefined,
    website: t.website || t.url || undefined,
    phone: t.phone || t["contact:phone"] || undefined,
    osmUrl: `https://www.openstreetmap.org/${el.osmType}/${el.osmId}`,
  });
}

// 家系確定の店を先に、その中は都道府県・店名順。
shops.sort(
  (a, b) =>
    (a.confidence === b.confidence ? 0 : a.confidence === "confirmed" ? -1 : 1) ||
    a.prefecture.localeCompare(b.prefecture, "ja") ||
    a.name.localeCompare(b.name, "ja"),
);

await fs.writeFile(path.join(DIR, "shops.json"), JSON.stringify(shops));

const byPref = {};
const byTaste = {};
for (const s of shops) {
  byPref[s.prefecture] = (byPref[s.prefecture] ?? 0) + 1;
  byTaste[s.taste] = (byTaste[s.taste] ?? 0) + 1;
}
console.error(`shops: ${shops.length} (confirmed ${shops.filter((s) => s.confidence === "confirmed").length})`);
console.error("taste:", byTaste);
console.error("top prefectures:", Object.entries(byPref).sort((a, b) => b[1] - a[1]).slice(0, 8));
