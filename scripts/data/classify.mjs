/**
 * OSM の要素を家系ラーメン店として判定・正規化するロジック。
 *
 * データ生成（build-dataset.mjs）とテストの両方から使うため、
 * ファイル入出力を持たない純粋な関数として切り出している。
 */
import { createHash } from "node:crypto";

/**
 * 判定に使ったタグの指紋。
 *
 * OSM の要素は ID を保ったまま中身が書き換わる。ID だけで再判定を飛ばすと、
 * 店名やジャンルが変わっても古い判定が残り続ける。
 * キーの順序は Overpass の応答によって変わりうるので、並べ替えてから取る。
 */
export function tagsFingerprint(tags) {
  const sorted = Object.keys(tags)
    .toSorted()
    .map((k) => `${k}=${tags[k]}`)
    .join("\n");
  return createHash("sha1").update(sorted).digest("hex").slice(0, 12);
}

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
};

/**
 * 家系ではないと分かっている店・チェーン。これも事実の対応表。
 * KNOWN_BRANDS より後に見る（誤った brand タグ 1 個で既知ブランドを消さないため）。
 */
export const EXCLUDE = [
  "杉田家住宅",
  "本家第一旭",
  "幸楽苑",
  "博多風龍",
  "長浜家",
  "山岡家",
  "古久家",
  "無敵家",
  "一蘭",
  "花月嵐",
  "日高屋",
  "ばんから",
  "来来亭",
];

/** 名前を持つ要素だけを返す。判定も重複除去もここが母集団。 */
export function namedElements(raw) {
  return raw.filter((el) => {
    const t = el.tags ?? {};
    return t["name:ja"] || t.name || t.brand;
  });
}

const EARTH_M = 6371000;
const rad = (d) => (d * Math.PI) / 180;

/** 2 地点の距離 (m)。重複候補の絞り込みにだけ使う。 */
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

/**
 * 重複判定にかけるべきペアを列挙する。
 *
 * find-duplicates が判定し、build-dataset が「その判定が今のデータと合っているか」を
 * 確かめる。両方が同じ列挙を使わないと検証にならないのでここに置く。
 */
export function nearbyPairs(raw, radiusM) {
  const els = namedElements(raw);
  const out = [];
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) {
      const d = distanceM(els[i], els[j]);
      if (d <= radiusM) out.push({ a: els[i], b: els[j], d });
    }
  }
  return out;
}

/** 指紋に使う、片側 1 件ぶんの文字列。 */
const fingerprintSide = (el) =>
  `${el.osmType}/${el.osmId}@${el.lat.toFixed(6)},${el.lon.toFixed(6)}#${tagsFingerprint(el.tags ?? {})}`;

/**
 * ペアの判定に使った入力の指紋。
 * 距離も判断材料なので、タグだけでなく座標も含める。
 */
export function pairFingerprint(a, b) {
  return createHash("sha1")
    .update([fingerprintSide(a), fingerprintSide(b)].toSorted().join("|"))
    .digest("hex")
    .slice(0, 12);
}

/**
 * 同一と判定したペアから、落とす側の id を決める。
 *
 * ペアを 1 組ずつ処理すると、3 件が同じ店のときに取りこぼす。
 * A=B と A=C が成り立つとき、先に A を落とすと A=C は「もう A は落ちている」
 * として飛ばされ、B と C が両方残る。連結成分にまとめてから、
 * 成分ごとに 1 件だけ残す。
 *
 * @param pairs   [{ a, b }] 同一と判定した組
 * @param weight  id → 残したさ。大きいほうを残す（何を優先するかは呼び出し側が決める）
 */
export function resolveDuplicates(pairs, weight) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  for (const { a, b } of pairs) parent.set(find(a), find(b));

  const groups = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }

  const dropped = new Set();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // 同じ重みなら id 順で決めて、実行ごとに結果が変わらないようにする。
    const keep = members.toSorted(
      (x, y) => (weight.get(y) ?? 0) - (weight.get(x) ?? 0) || x.localeCompare(y),
    )[0];
    for (const id of members) if (id !== keep) dropped.add(id);
  }
  return dropped;
}

/** 支店名やブランドの揺れを吸収して、既知ブランドを 1 つ返す。 */
export function matchBrand(text) {
  return Object.keys(KNOWN_BRANDS).find((b) => text.includes(b));
}

/**
 * 対応表だけで分かることを引く。モデルに聞くまでもない事実。
 *
 * 見る順序が要点。店名の除外 → ブランド照合 → brand/operator の除外。
 * ブランド照合を brand/operator の除外より先にしないと、誤ったタグ 1 個で
 * 既知の家系ブランドが丸ごと消える。かといって店名の除外より先にすると、
 * ブランド名を含むだけの別物（杉田家住宅）を家系にしてしまう。
 */
export function knownFacts(tags) {
  const name = tags["name:ja"] || tags.name || tags.brand || "";
  const haystack = [name, tags.brand, tags.operator].filter(Boolean).join(" ");

  // 店名そのものが除外に当たるなら、ブランドの部分一致より優先する。
  // 「杉田家住宅」は「杉田家」を含むが文化財で、飲食店ですらない。
  // 逆に brand / operator 側だけが除外に当たる場合は、タグの誤りのほうを疑う
  // （魂心家に brand=幸楽苑 が付いている実例がある）。
  const notIekeiInName = EXCLUDE.find((x) => name.includes(x));
  if (notIekeiInName) return { notIekei: notIekeiInName };

  const iekeiBrand = matchBrand(haystack);
  return {
    iekeiBrand,
    taste: iekeiBrand ? KNOWN_BRANDS[iekeiBrand] : undefined,
    notIekei: EXCLUDE.find((x) => haystack.includes(x)),
  };
}

/**
 * addr:* タグから表示用の住所を組み立てる。city は別フィールドなので含めない。
 *
 * 区・町名・丁目は続けて書くが、街区符号（block_number = 番）と
 * 住居番号（housenumber = 号）は別の数字なので「-」で繋ぐ。
 * 全部を続けて書くと「下忍」+「3594」+「1」が「下忍35941」になってしまう。
 */
export function buildAddress(tags) {
  const city = tags["addr:city"] || undefined;
  const area = [tags["addr:suburb"], tags["addr:quarter"], tags["addr:neighbourhood"]]
    .filter(Boolean)
    .join("");
  const number = [tags["addr:block_number"], tags["addr:housenumber"]].filter(Boolean).join("-");
  const address = area + number;

  // suburb が「横浜市西区」のように city を含むことがあるので取り除く。
  // city は OSM 由来の任意文字列なので、正規表現には組み立てない。
  const trimmed = city && address.startsWith(city) ? address.slice(city.length) : address;

  return { city, address: trimmed || undefined };
}

/**
 * OSM 要素 1 件を Shop に変換する。家系でなければ null。
 *
 * 判定そのものは持たない。judge-all.mjs が出した結果を受け取るだけにして、
 * 「何を店として載せるか」と「どう整形するか」を分けている。
 *
 * @param el         osm-raw.json の 1 要素
 * @param judgement  judged.json の 1 件（{ verdict, taste }）
 */
export function toShop(el, judgement) {
  const t = el.tags ?? {};
  const confidence = judgement?.verdict;
  if (!confidence) return null;

  const name = t["name:ja"] || t.name || t.brand;
  const knownBrand = matchBrand([name, t.brand, t.operator].filter(Boolean).join(" "));
  const { city, address } = buildAddress(t);

  return {
    id: `${el.osmType}/${el.osmId}`,
    name,
    nameEn: t["name:en"] || undefined,
    brand: t.brand || knownBrand || undefined,
    taste: judgement.taste ?? "unknown",
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
