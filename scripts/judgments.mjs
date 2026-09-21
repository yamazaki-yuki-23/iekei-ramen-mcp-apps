/**
 * TypeSafe に投げる質問と、答えを判定に変える閾値。
 *
 * 人間がレビューすべきものはこのファイルに全部入れる（公式の推奨）。
 * 判定を変えたくなったら、ここの文面か下の定数だけを触る。
 * 呼び出し側はこのファイルを読むだけで、独自のルールを持たない。
 *
 * 質問文が英語なのは、Jev の主要学習言語が英語で CJK は同等ではないと
 * 明記されているため。state（店名やタグ）は日本語のまま渡す。
 */
import { choice, noul, score } from "@typesafe-ai/sdk";

/** 1 つの指標だけで家系と断定してよい確率。 */
export const CONFIRMED_AT = 0.9;
/**
 * 単独では足りないが、2 つそろえば断定してよい下限。
 *
 * 「横浜ラーメン〜」を冠する店は、家系だと名乗っているのか地名なのかが
 * 曖昧なので name_declares_iekei が 0.69〜0.89 に散る。閾値 1 本だと
 * 0.88 の「横浜ラーメン 裏武蔵家」が確定で 0.87 の「横浜ラーメン 田上家」が
 * 可能性、という 0.01 差の線引きになり、流し直すたびに入れ替わる。
 *
 * 全 752 件の分布は 2 つの山に割れていて、その間が両方の指標で空いている。
 *   name_declares_iekei … 0.51 と 0.69 の間に 1 件も無い
 *   genre の iekei      … 0.38 と 0.78 の間に 1 件も無い
 * どちらも谷の底が 0.6 付近なので、そこに置いて「両方が中程度以上なら確定」
 * とする。閾値 1 本を動かすより、独立した 2 つの合意を見るほうが揺れない。
 */
export const CONFIRMED_PAIR_AT = 0.6;
/** 家系の可能性ありとして扱う下限。 */
export const LIKELY_AT = 0.6;
/** ジャンルを判断できないと見なす下限。ここに入ると「候補」段になる。 */
export const UNCLEAR_AT = 0.6;
/**
 * 屋号が「〜家」だと見なす下限。
 *
 * 全 752 件の分布は 0.0〜0.3 に 62 件、0.8 以上に 325 件で、その間の
 * 0.4〜0.7 には 11 件しかない。谷の底に置いてある。
 * 0.4 にしても 0.7 にしても候補は 11 件しか動かないので、値そのものは効かない。
 * 効かないこと自体が、正しい位置にある証拠。
 */
export const YAGO_AT = 0.5;
/** ラーメン店ですらないと見なす上限。 */
export const RAMEN_AT = 0.5;

/** 同一店舗と見なす Score の下限（0=別店舗 / 1=判断できない / 2=同じ店）。 */
export const SAME_SHOP_AT = 1.5;
/** 重複候補として判定にかける距離 (m)。これより離れていれば別店舗として扱う。 */
export const PAIR_RADIUS_M = 200;

/** OSM の要素 1 件を state に変換する。判定に関係するタグだけを渡す。 */
export function shopState(tags) {
  const pick = (k) => tags[k] || undefined;
  return {
    shop: {
      name: tags["name:ja"] || tags.name || tags.brand,
      name_en: pick("name:en"),
      brand: pick("brand"),
      operator: pick("operator"),
      cuisine: pick("cuisine"),
      amenity: pick("amenity"),
      shop: pick("shop"),
      website: pick("website"),
    },
  };
}

/**
 * 1 リクエストにまとめて投げる。並列評価されるので、使うか分からない質問も足してよい。
 * taste は家系だったときしか読まないが、分けて 2 往復する理由が無い。
 */
export const QUESTIONS = {
  is_ramen_shop: noul(
    "Is `shop` a ramen restaurant? Japanese shop names often name the genre directly.",
    {
      true: "A restaurant whose main product is ramen.",
      false:
        "A soba, udon, tsukemen-only, gyoza, izakaya, or general restaurant, or something that is not a restaurant at all (a historic house, a shop, an office).",
    },
  ),

  name_declares_iekei: noul(
    "Does the name or brand of `shop` explicitly declare that it is iekei (家系) ramen? Read the characters as written; Japanese map data contains typos, so a near-miss spelling of 家系 still counts, and so does 横浜ラーメン or 横濱ラーメン used as a genre label.",
    {
      true: "The name itself states the genre, e.g. 家系 / 横浜家系 / 横濱家系 / 横浜ラーメン, including a misspelling of those.",
      false: "The name does not state the genre, even if the shop might serve iekei.",
    },
  ),

  known_iekei_brand: noul(
    "Is the shop named in `shop` a branch of a well-known iekei ramen chain or lineage (for example 吉村家, 壱六家, 町田商店, 武蔵家, 魂心家, 王道家)?",
    {
      true: "A recognized iekei brand or one of its direct descendants.",
      false:
        "An independent shop, or a chain that is not iekei (for example 幸楽苑, 一蘭, 日高屋, 来来亭, 山岡家).",
    },
  ),

  // 壊れていた正規表現 name.replace(/[\s（(].*$/, "") が本当にやりたかった判断。
  // 「屋号が〜家か」は、空白の位置ではなく語の役割の問題なので文字列処理では届かない。
  yago_is_ya: noul(
    "Ignoring any genre prefix (ラーメン, らーめん, 横浜ラーメン, 中華そば), branch suffix (〜店, 〜本店), and parenthetical, does the shop's own trade name in `shop.name` end with 家 used as a name suffix (屋号)?",
    {
      true: "The trade name itself ends in 家, as in 田上家, 吉村家, たから家, ラーメン 千葉家.",
      false:
        "家 only appears inside a word that is not the trade name, such as 自家製麺 (house-made noodles), 麺家 or 中華飯店 used as a generic shop word, or 〜家食堂 / 〜家製麺 where another word follows.",
    },
  ),

  genre: choice(
    "Judging from every field of `shop`, which ramen genre does it most likely serve? A name ending in 家 is weak evidence for iekei on its own, because many unrelated Japanese restaurants use 家 as a suffix.",
    {
      iekei: "Yokohama iekei: tonkotsu-shoyu broth, thick straight noodles, spinach and nori.",
      hakata_tonkotsu: "Hakata or other Kyushu tonkotsu.",
      sapporo_miso: "Miso ramen, often Sapporo style.",
      shio_or_shoyu: "Shio or a clear shoyu / chuka-soba style.",
      niboshi: "Niboshi or seafood-forward broth.",
      tsukemen_or_mazesoba: "Tsukemen, mazesoba, or abura-soba as the main product.",
      jiro: "Jiro-style.",
      tantanmen: "Tantanmen or other Chinese-influenced spicy noodles.",
      // 「中華料理店」「食堂」の行き場が無いと unclear に落ちる。
      // モデルは用意していない選択肢を選べない。中華飯店菜家がそれで候補に残っていた。
      chuka_ryori:
        "A Chinese restaurant (中華料理店 / 中華飯店 / 町中華) that serves ramen alongside fried rice, gyoza and other dishes, rather than a ramen specialist. Note that 中華そば on its own is a shoyu ramen style and belongs under shio_or_shoyu, not here.",
      shokudo:
        "A general diner (食堂 / 定食屋) or izakaya that serves ramen among many unrelated dishes.",
      other_ramen: "Ramen, but none of the above.",
      not_ramen: "Not a ramen shop.",
      unclear: "The fields give no usable signal about the genre.",
    },
  ),

  // 味の質問はここにあったが、外した。
  // 「ブランドが特定できなければ unknown と答えよ」と指示しても、家系を名乗る店に
  // 一律 rich を返してくる（80 件すべて rich、確信度 0.3〜0.8）。ブランド名に対する
  // 知識の問題で、質問文では埋まらない。味は KNOWN_BRANDS の対応表からだけ取る。
};

/**
 * 近い 2 件が同じ店舗かを判定する質問。
 *
 * OSM は同じ店を node と way の両方に持つことがあり、座標も名前も少しずれる。
 * 「name@座標」のキーで潰そうとすると、まさにその node/way 重複を取りこぼす。
 * 3 段階にしてあるのは、その 3 つがそのままコードの取りうる処理だから。
 */
export const PAIR_QUESTION = {
  same_shop: score(
    "`pair.a` and `pair.b` are two OpenStreetMap entries that are `pair.distance_m` metres apart. Do they describe the same physical restaurant recorded twice, or two different restaurants that happen to be near each other?",
    [
      "Clearly two different restaurants: the trade names are unrelated, or they are known to be separate businesses.",
      "Cannot tell from these fields alone.",
      "Clearly the same restaurant: the same trade name and the same location, recorded once as a node and once as a way, or with a small difference in spelling or branch suffix.",
    ],
  ),
};

/** 重複判定に使うタグだけを抜き出す。 */
const pairSide = (el) => ({
  osm_type: el.osmType,
  name: el.tags["name:ja"] || el.tags.name || el.tags.brand,
  brand: el.tags.brand || undefined,
  operator: el.tags.operator || undefined,
  branch: el.tags.branch || undefined,
  address:
    [el.tags["addr:city"], el.tags["addr:suburb"], el.tags["addr:block_number"]]
      .filter(Boolean)
      .join("") || undefined,
  phone: el.tags.phone || el.tags["contact:phone"] || undefined,
  website: el.tags.website || el.tags.url || undefined,
});

/** 2 件分のタグを 1 つの state にまとめる。 */
export function pairState(a, b, distanceM) {
  return { pair: { a: pairSide(a), b: pairSide(b), distance_m: Math.round(distanceM) } };
}

/**
 * 答えを 3 段階 + 除外に落とす。ここが判定の全て。
 *
 * 「家系ではない」と「判定できない」を分けるのが要点。前者は別ジャンルだと
 * 分かっているもの、後者は店名に手がかりが無いもので、扱いが違う。
 *
 * @param answers TypeSafe の回答
 * @param known   既知ブランドの照合結果（事実の対応表なのでモデルより優先する）
 * @returns {{ verdict: "confirmed"|"likely"|"candidate"|null, taste: string, why: string }}
 */
export function decide(answers, known = {}) {
  const iekei = answers.genre.probabilities.iekei ?? 0;
  const unclear = answers.genre.probabilities.unclear ?? 0;
  // 味は対応表に載っているブランドだけ。推測はしない（OSM に味のデータは無い）。
  const taste = known.taste ?? "unknown";

  // 既知ブランドはモデルに聞くまでもない。表にある事実が勝つ。
  if (known.iekeiBrand) {
    return { verdict: "confirmed", taste, why: `既知ブランド ${known.iekeiBrand}` };
  }
  if (known.notIekei) {
    return { verdict: null, taste: "unknown", why: `家系ではない既知の店 ${known.notIekei}` };
  }

  if (answers.name_declares_iekei.noul >= CONFIRMED_AT) {
    return { verdict: "confirmed", taste, why: "店名が家系を名乗っている" };
  }
  if (answers.name_declares_iekei.noul >= CONFIRMED_PAIR_AT && iekei >= CONFIRMED_PAIR_AT) {
    return {
      verdict: "confirmed",
      taste,
      why: `店名と味の傾向が一致（名乗り ${answers.name_declares_iekei.noul.toFixed(2)} / 家系 ${iekei.toFixed(2)}）`,
    };
  }
  if (answers.known_iekei_brand.noul >= CONFIRMED_AT) {
    return { verdict: "confirmed", taste, why: "モデルが既知の家系ブランドと判断" };
  }
  if (answers.is_ramen_shop.noul < RAMEN_AT) {
    return { verdict: null, taste: "unknown", why: "ラーメン店ではない" };
  }
  if (iekei >= LIKELY_AT) {
    return { verdict: "likely", taste, why: `家系の確率 ${iekei.toFixed(2)}` };
  }
  // ジャンルを言い当てられないが、屋号が「〜家」のラーメン店。
  // 取得クエリが cuisine~ramen かつ name~家 に絞っているので、この母集団は狭い。
  if (unclear >= UNCLEAR_AT && answers.yago_is_ya.noul >= YAGO_AT) {
    return { verdict: "candidate", taste: "unknown", why: `判定材料なし（屋号が〜家）` };
  }
  return {
    verdict: null,
    taste: "unknown",
    why: `家系 ${iekei.toFixed(2)} / 不明 ${unclear.toFixed(2)}`,
  };
}
