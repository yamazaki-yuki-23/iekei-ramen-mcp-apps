import { createHash } from "node:crypto";
import { distanceM } from "./classify.mjs";

/** 記録と、引いた座標（data/verified-geo.json）を結ぶ鍵。住所を直したら別の鍵になり、引き直される。 */
export const geoKey = (record) => `${record.prefecture}${record.address}`;

const KANJI_DIGITS = "〇一二三四五六七八九";
const digitsOf = (text) => [...text].reduce((sum, c) => sum * 10 + KANJI_DIGITS.indexOf(c), 0);
/** 「二十三」→ 23。丁目や条の漢数字だけを相手にするので 99 まで。 */
const kanjiNumber = (text) => {
  const [tens, ones] = text.includes("十") ? text.split("十") : ["〇", text];
  return String((text.includes("十") ? digitsOf(tens) || 1 : 0) * 10 + digitsOf(ones));
};
/**
 * 比べるための形: 数字は半角の算用数字、ヶ・ケ・が は同じ、字は無視。文字どうしの間の空白は消すが、
 * **数字の隣の空白は残す。** 番地と建物名の境目なので（消すと「2-2-7 八景坂ビル」が 78、
 * 「3-3-2 第1旅客ターミナル」が 3-3-2-1 に見える）。
 */
const normalize = (text) =>
  text
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[〇一二三四五六七八九十]+/g, kanjiNumber)
    .replace(/[ヶケが]/g, "ケ")
    .replace(/大字|字/g, "")
    .replace(/(?<=\D)\s+(?=\D)/g, "")
    .replace(/\s+/g, " ");

/**
 * 国土地理院の住所検索が、番地（または街区）の精度で当たったか。
 *
 * 当たらなかったときは町や字までの名前（「岩手県一関市山目泥田」）で返るので、名前が
 * 「〜番」「〜番地」「〜番〜号」で終わるかで分かる。**名前の末尾の数字の並び（「一丁目１番」なら 1, 1）が、
 * 公式の住所の数字に同じ順で続けて出るか**まで見る。数字が 1 つ住所にあるだけで通すと、
 * 「1-20-5」に「一丁目１番」が当たったものを番地の精度として扱ってしまう（丁目と街区の取り違え）。
 */
export function isPrecise(title, record) {
  if (!title.startsWith(record.prefecture)) return false;
  const name = normalize(title.slice(record.prefecture.length));
  const tail = name.match(/(?:\d+\D{1,2})*\d+番地?(?:\d+号)?$/);
  if (!tail) return false;
  /*
   * **町の名前も合わせる。** 同じ県の別の町に当たっても、数字の並びは合うことがある
   * （「盛岡市大通1-20-5」に「盛岡市別町一丁目２０番」）。公式の住所で町の名前のすぐ後に
   * 続く数字が、同じ並びで始まるときだけ通す。
   */
  const town = name.slice(0, tail.index);
  const address = normalize(record.address);
  const at = address.indexOf(town);
  if (!town || at === -1) return false;
  const wanted = tail[0].match(/\d+/g);
  /*
   * 町の名前のすぐ後に続く数字の塊（「1-6-1」なら 1, 6, 1）。建物名の数字は空白の後なので含めない。
   * **当たらずに残るのは 1 つまで**（「1-1-16」に「一丁目１番」の号、「109-2」に「１０９番地」の枝番）。
   * 2 つ以上残るなら、手前の番号にしか当たっていない（「大島田1-6-1」に「大島田１番地」）。
   */
  const following =
    address
      .slice(at + town.length)
      .match(/^\d+(?:[^\d\s]{1,2}\d+)*/)?.[0]
      .match(/\d+/g) ?? [];
  return wanted.every((n, i) => following[i] === n) && following.length - wanted.length <= 1;
}

const same = (a, b) => normalize(a) === normalize(b);

/**
 * 市区町村と、その残りの住所。市区町村は座標から Nominatim で引いたもの（一覧のまとめ方を
 * 今の店と揃えるため）だが、**公式の住所の頭と合わなければ使わない。** 境の近くでは隣の
 * 市区町村を返すことがある（実測: 練馬区旭町が「板橋区」、豊明市が「名古屋市」）。そのときは
 * 公式の住所の頭から取る。
 */
export function splitCity(address, reversed) {
  const withoutGun = address.replace(/^[^\d\s]+?郡\s*/, "");
  // 郡は市区町村ではない（Nominatim は町名が無いと county で郡を返す）。
  const usable = reversed && !reversed.endsWith("郡") ? reversed : undefined;
  for (const text of [address, withoutGun]) {
    if (usable && same(text.slice(0, usable.length), usable))
      return { city: usable, address: text.slice(usable.length).trim() };
  }
  const head = withoutGun.split(/[\d０-９]/)[0];
  for (const suffix of ["市", "区", "町", "村"]) {
    const city = head.match(new RegExp(`^\\S+?${suffix}`))?.[0];
    if (city) return { city, address: withoutGun.slice(city.length).trim() };
  }
  return { city: undefined, address };
}

/** 座標を引いて足す対象: 今のデータに無い、営業中の店。 */
export const toAdd = (records) => records.filter((r) => !("id" in r) && r.status === "open");

/**
 * 確かめた記録から、一覧に足す店を作る。番地の精度で座標が取れた店だけ。
 *
 * **記録に無いことは埋めない。** 味は `unknown`（情報なし）、OSM のリンクは OSM に
 * その店がある（`osmId`）ときだけ。判定は `confirmed`: 系列の公式の一覧に載っていることが、
 * 「既知の家系ブランド」という判定の定義そのものなので。
 *
 * ID は都道府県と住所から作る。訪問記録がこの ID を指すので、住所を直さない限り変わらない。
 */
export function verifiedShops(records, geo) {
  /*
   * **引いていない記録があれば止める。** 黙って飛ばすと、data:geocode を忘れたり途中で
   * 止めたりしたときに、店の欠けた shops.json が正常終了で書き出される。
   * 番地まで当たらなかった店（precise: false）は引いた結果なので、止めずに飛ばす。
   */
  const missing = toAdd(records).filter((record) => !geo[geoKey(record)]);
  if (missing.length > 0) {
    throw new Error(
      `座標を引いていない記録が ${missing.length} 件あります。先に npm run data:geocode を実行してください。\n  ` +
        missing
          .slice(0, 5)
          .map((record) => `${record.name}（${geoKey(record)}）`)
          .join("\n  "),
    );
  }
  const shops = [];
  for (const record of toAdd(records)) {
    const g = geo[geoKey(record)];
    /*
     * 判定の決まりを直したら、引き直さずに効くよう、残した名前で毎回確かめる。
     * 系列の公式の店舗データの座標（source: chain-list）は住所から引いていないので、確かめない（#250）。
     */
    if (g.source !== "chain-list" && (!g.precise || !isPrecise(g.title, record))) continue;
    // 市区町村は住所の頭と重なるので、残りだけを住所として出す（「盛岡市 盛岡市津志田南…」にしない）。
    const { city, address } = splitCity(record.address, g.city);
    shops.push({
      id: `verified/${createHash("sha256").update(geoKey(record)).digest("hex").slice(0, 20)}`,
      name: record.name,
      brand: record.chain,
      taste: "unknown",
      confidence: "confirmed",
      prefecture: record.prefecture,
      ...(city ? { city } : {}),
      address,
      lat: g.lat,
      lon: g.lon,
      ...(record.osmId ? { osmUrl: `https://www.openstreetmap.org/${record.osmId}` } : {}),
    });
  }
  return shops;
}

/**
 * 足す店から 100m 以内にある今の店。**系列を問わずに全部**挙げる。OSM の店名が
 * 「横浜家系ラーメン」だけだったり古かったりして、店名や系列では同じ店に見えないことがある
 * （実測: 町田商店 荻窪店の 5m 先に、店名が「横浜家系ラーメン」だけの店）。
 */
export function nearbyShops(added, shops, radiusM = 100) {
  return added.flatMap((a) =>
    shops
      .filter((s) => distanceM(a, s) <= radiusM)
      .map((s) => ({ added: a, existing: s, distanceM: Math.round(distanceM(a, s)) })),
  );
}

/**
 * 近くの今の店が、同じ店かもしれないので足さない方がよいか。
 *
 * - 同じ系列で、公式の一覧に無い（`unlisted`）: 位置か店名が古いだけの同じ店のことが多い（実測: 5m・22m）
 * - 店名が「横浜家系ラーメン」のような一般名だけ: どの店か分からないので、同じ店でないと言えない
 *
 * 店名を持つ別の店（道玄家・山本家など）は、近くても別の店として足す。
 */
export function maybeSameShop(added, existing, unlisted) {
  // 店自身が名乗る記録（basis: self）は系列を持たない。無い同士を「同じ系列」と見ない。
  const sameChain =
    Boolean(added.brand) && (existing.brand === added.brand || existing.name.includes(added.brand));
  const generic = existing.name.replace(/横浜|家系|ラーメン|らーめん|\s/g, "") === "";
  return (sameChain && unlisted.has(existing.id)) || generic;
}
