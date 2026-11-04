/**
 * 市区町村の名前を、総務省の全国地方公共団体コードの名前にそろえる（#349）。
 *
 * OSM の `addr:city` は入力した人によって、町名や番地まで入っていたり（「酒田市上安町」）、
 * 「市」が無かったり（「横手」）、政令市の区だけだったり（「中区」）する。市区町村のページは
 * この名前でまとめるので、そのままだと 1 軒だけの壊れたページができる。
 * 政令市は区ではなく市でまとめ（今の一覧と同じ）、区と町名は住所の頭に回す。
 *
 * `data/municipalities.json` は、都道府県 → 名前 → 読み（カタカナ）。政令市の区は
 * 「横浜市中区」の形で入っている。
 */

/** 政令市の区（「横浜市中区」）なら、市と区に分ける。 */
const wardOf = (names, name) => {
  const match = /^(.+?市)(.+区)$/.exec(name);
  return match && names[match[1]] ? [match[1], match[2]] : undefined;
};

/**
 * 一覧の市区町村名と、住所の頭に回す残りを返す。一覧のどれにも当てられなければ undefined。
 * @returns {{ city: string, rest: string } | undefined}
 */
export function officialCity(municipalities, prefecture, city) {
  const names = municipalities[prefecture] ?? {};
  const text = city.trim().replace(new RegExp(`^${prefecture}\\s*`), "");
  // 長い名前から当てる（「熊本市中央区」を「熊本市」より先に。区を住所に回すため）。
  const prefix = Object.keys(names)
    .filter((name) => text.startsWith(name))
    .toSorted((a, b) => b.length - a.length)[0];
  if (prefix) {
    const ward = wardOf(names, prefix);
    const rest = text.slice(prefix.length).trim();
    return ward ? { city: ward[0], rest: ward[1] + rest } : { city: prefix, rest };
  }
  if (names[`${text}市`]) return { city: `${text}市`, rest: "" };
  // 区だけ（「中区」）。同じ県に同じ名前の区が 2 つあれば（「緑区」）決められない。
  const wards = Object.keys(names)
    .map((name) => wardOf(names, name))
    .filter((ward) => ward?.[1] === text);
  return wards.length === 1 ? { city: wards[0][0], rest: text } : undefined;
}

/** 店の市区町村を一覧の名前にし、残りを住所の頭に付ける。当てられなければ undefined。 */
export function withOfficialCity(municipalities, shop) {
  if (!shop.city) return shop;
  const found = officialCity(municipalities, shop.prefecture, shop.city);
  if (!found) return undefined;
  if (found.city === shop.city) return shop;
  // 番地で終わる残りと住所の間だけ空ける（「湯川町財部70-8 薗」）。
  const gap = /\d$/.test(found.rest) && shop.address ? " " : "";
  const address = `${found.rest}${gap}${shop.address ?? ""}`;
  return { ...shop, city: found.city, ...(address ? { address } : {}) };
}

/* ヘボン式（#341）。長音は書かない（「トウキョウ」→ tokyo、「オオサカ」→ osaka）。撥音は n のまま。 */
const KANA = {
  ア: "a",
  イ: "i",
  ウ: "u",
  エ: "e",
  オ: "o",
  カ: "ka",
  キ: "ki",
  ク: "ku",
  ケ: "ke",
  コ: "ko",
  サ: "sa",
  シ: "shi",
  ス: "su",
  セ: "se",
  ソ: "so",
  タ: "ta",
  チ: "chi",
  ツ: "tsu",
  テ: "te",
  ト: "to",
  ナ: "na",
  ニ: "ni",
  ヌ: "nu",
  ネ: "ne",
  ノ: "no",
  ハ: "ha",
  ヒ: "hi",
  フ: "fu",
  ヘ: "he",
  ホ: "ho",
  マ: "ma",
  ミ: "mi",
  ム: "mu",
  メ: "me",
  モ: "mo",
  ヤ: "ya",
  ユ: "yu",
  ヨ: "yo",
  ラ: "ra",
  リ: "ri",
  ル: "ru",
  レ: "re",
  ロ: "ro",
  ワ: "wa",
  ヰ: "i",
  ヱ: "e",
  ヲ: "o",
  ン: "n",
  ガ: "ga",
  ギ: "gi",
  グ: "gu",
  ゲ: "ge",
  ゴ: "go",
  ザ: "za",
  ジ: "ji",
  ズ: "zu",
  ゼ: "ze",
  ゾ: "zo",
  ダ: "da",
  ヂ: "ji",
  ヅ: "zu",
  デ: "de",
  ド: "do",
  バ: "ba",
  ビ: "bi",
  ブ: "bu",
  ベ: "be",
  ボ: "bo",
  パ: "pa",
  ピ: "pi",
  プ: "pu",
  ペ: "pe",
  ポ: "po",
  ヴ: "vu",
};
const SMALL = { ャ: "a", ュ: "u", ョ: "o", ァ: "a", ィ: "i", ゥ: "u", ェ: "e", ォ: "o" };

export function hepburn(kana) {
  let out = "";
  for (let i = 0; i < kana.length; i++) {
    const c = kana[i];
    const next = kana[i + 1];
    if (c === "ー") continue;
    if (c === "ッ") {
      const after = KANA[next] ?? "";
      out += after.startsWith("ch") ? "t" : (after[0] ?? "");
      continue;
    }
    let syllable = KANA[c];
    if (syllable === undefined) throw new Error(`ローマ字にできない文字: ${c}（${kana}）`);
    if (next in SMALL) {
      // キャ → kya、シャ → sha、ジャ → ja、チャ → cha
      const head = syllable.length > 1 ? syllable.slice(0, -1) : syllable;
      syllable = /^(sh|ch|j)$/.test(head) ? head + SMALL[next] : `${head}y${SMALL[next]}`;
      i++;
    }
    out += syllable;
  }
  return out.replace(/ou|oo/g, "o").replace(/uu/g, "u");
}

/*
 * 総務省の一覧の読みは、拗音の小さい字を大きく書いていることがある（本庄市「ホンジヨウシ」）。
 * 大きい字のまま正しいもの（清瀬市「キヨセシ」）と見分けられないので、1 つずつ確かめて直す。
 * 「キ・シ・チ・ニ・ヒ・ミ・リ・ギ・ジ・ビ・ピ」の後に大きい「ヤ・ユ・ヨ」が来る 82 件を見て、拗音だった分。
 */
const SMALL_WRITTEN_LARGE = {
  山形県庄内町: "ショウナイマチ",
  群馬県中之条町: "ナカノジョウマチ",
  埼玉県行田市: "ギョウダシ",
  埼玉県本庄市: "ホンジョウシ",
  埼玉県羽生市: "ハニュウシ",
  千葉県九十九里町: "クジュウクリマチ",
  千葉県御宿町: "オンジュクマチ",
  千葉県鋸南町: "キョナンマチ",
  滋賀県竜王町: "リュウオウチョウ",
  大阪府四條畷市: "シジョウナワテシ",
  奈良県広陵町: "コウリョウチョウ",
  岡山県総社市: "ソウジャシ",
  岡山県新庄村: "シンジョウソン",
  沖縄県北谷町: "チャタンチョウ",
};

/** 名前の末尾（市・区・町・村）と、読みから外す部分。 */
const SUFFIX = [
  [/市$/, /シ$/, "shi"],
  [/区$/, /ク$/, "ku"],
  [/町$/, /(?:マチ|チョウ)$/, null],
  [/村$/, /(?:ムラ|ソン)$/, null],
];

/**
 * 都道府県の中の市区町村 → URL の英字の名前（#341）。読みは総務省の一覧のもの。
 * 「市」「町」などは付けず（名古屋市 → nagoya）、同じ県で同じ英字になるものだけ末尾を付ける
 * （広島県の府中市と府中町 → fuchu-shi・fuchu-cho）。政令市の区は市でまとめるので作らない。
 */
export function citySlugs(municipalities, prefecture) {
  const names = municipalities[prefecture] ?? {};
  const entries = Object.entries(names)
    .filter(([name]) => !wardOf(names, name))
    .map(([name, written]) => {
      const kana = SMALL_WRITTEN_LARGE[`${prefecture}${name}`] ?? written;
      const [, kanaTail, label] = SUFFIX.find(([tail]) => tail.test(name)) ?? [];
      const base = hepburn(kanaTail ? kana.replace(kanaTail, "") : kana);
      const tail = label ?? hepburn(kana.match(kanaTail)?.[0] ?? "");
      return { name, base, full: tail ? `${base}-${tail}` : base };
    });
  const count = new Map();
  for (const { base } of entries) count.set(base, (count.get(base) ?? 0) + 1);
  const slugs = new Map(
    entries.map(({ name, base, full }) => [name, count.get(base) > 1 ? full : base]),
  );
  // 読みまで同じ町（北海道の江差町と枝幸町、どちらもエサシチョウ）は決められないので、表に入れない。
  // 店が載ると、使う側で「英字の名前が無い」と止まる。
  const used = new Map();
  for (const slug of slugs.values()) used.set(slug, (used.get(slug) ?? 0) + 1);
  for (const [name, slug] of slugs) if (used.get(slug) > 1) slugs.delete(name);
  return slugs;
}
