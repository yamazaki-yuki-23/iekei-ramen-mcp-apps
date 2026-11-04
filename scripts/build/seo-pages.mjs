import { tabBarHtml } from "../../src/utils/tabbar.ts";
import { legalLinksHtml } from "../../src/utils/legal-links.ts";
import { legalMarkdown } from "./legal-markdown.mjs";
import { citySlugs } from "../data/municipalities.mjs";
import municipalities from "../../data/municipalities.json" with { type: "json" };
import { recordShopId } from "../data/verified-shops.mjs";
import { ALL_PREFECTURES } from "../../src/utils/prefectures.ts";
import { distanceKm, formatDistance } from "../../src/utils/geo.ts";
import { openingHoursLabel } from "../../src/utils/opening-hours.ts";
import {
  ORDER_DISCLAIMER,
  ORDER_SETS,
  PREFERENCES,
  SIDE_TIPS,
} from "../../src/utils/order-guide.ts";

const origin = "https://iekeiramen.com";
const slugs =
  "hokkaido aomori iwate miyagi akita yamagata fukushima ibaraki tochigi gunma saitama chiba tokyo kanagawa niigata toyama ishikawa fukui yamanashi nagano gifu shizuoka aichi mie shiga kyoto osaka hyogo nara wakayama tottori shimane okayama hiroshima yamaguchi tokushima kagawa ehime kochi fukuoka saga nagasaki kumamoto oita miyazaki kagoshima okinawa".split(
    " ",
  );
const prefectureSlugs = new Map(ALL_PREFECTURES.map((name, index) => [name, slugs[index]]));
/*
 * 但し書きは一覧のすぐ下に 1 回（#152）。推定・誤りの報告の道・営業状況の確かめ方を
 * 1 段落にまとめる。アプリの ResultCaveat と同じ言い方にそろえる。報告は店のページから
 * 送れる（#255。前はアプリで店を開いてから 4 段かかった）。
 */
const note =
  "家系かどうかは地図の記載と既知のブランドからの推定（一部の店は公式の情報で確かめています）、味の傾向は既知のブランドからの参考値で、実食に基づくものではありません。営業状況は店舗の公式情報で確認してください。違う店があれば、その店のページの「この店の情報、違っていませんか？」から教えてください。";
/** 県・市区町村ページの見出しの下（#255）。題名と説明文（検索結果の文字）は変えない。 */
const listLead =
  "地図の記載とブランドから集めた一覧です。違う店を見つけたら、店のページから教えてください。";
/**
 * 店のページの「この情報について」（#255）。前は灰色の長い 1 文で、読み飛ばされた。
 * 中身は消さず、項目ごとの表にする（家系かどうか・味・営業時間と電話・違っていたら）。
 */
const ESTIMATED = "地図の記載と既知のブランドからの推定";
/** 確かめた先の言い方。記録の `url` は画面に出さない（docs/development/data.md）。 */
const CHECKED_AT = {
  "chain-list": "系列の公式の店舗一覧",
  "official-site": "店の公式サイト",
  "official-sns": "店の公式 SNS",
};
/**
 * 「家系かどうか」の欄（#316）。公式の情報で確かめた記録（`status: open`）がある店は、
 * 確かめた先と日付を書く。記録が無い店は推定のまま。
 */
const basisLabel = (record) =>
  record?.status === "open" && CHECKED_AT[record.source]
    ? `${CHECKED_AT[record.source]}${/[A-Za-z]$/.test(CHECKED_AT[record.source]) ? " " : ""}で確かめた（${record.checked}）`
    : ESTIMATED;
const ABOUT = [
  ["味の分類", "既知のブランドからの参考値（食べて決めたものではありません）"],
  ["営業時間・電話", "地図の記載。変わることがあるので、行く前に店の公式情報で確かめてください"],
  ["違っていたら", "上の「この店の情報、違っていませんか？」から"],
];
/**
 * 店のページから送れる報告の種類（#255）。ボタンの名前と、受け口（/reports）の kind。
 * 受け口の検査（src/lib/reports.ts）がどの kind も受け取ることは、tests/seo-pages.test.ts が見張る。
 */
export const REPORT_KINDS = [
  { kind: "closed", label: "閉店している" },
  { kind: "not-iekei", label: "家系ではない" },
  { kind: "wrong-location", label: "場所が違う" },
];
/**
 * 地図の記載の電話番号を、国内の書き方にする（#255）。「+81」を 0 に替え、空白はハイフンにする。
 * 区切りの位置は推し量らない（地図の記載に区切りが無ければ、無いまま出す）。
 */
export const domesticPhone = (raw) =>
  raw
    .trim()
    .replace(/^\+81[\s-]*0?/, "0")
    .replace(/\s+/g, "-");
/** 近い家系の数（#255）。行き止まりにしないため。多く並べると、どれも同じ重さに見える。 */
const NEARBY = 3;
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
const region = (shop) => [shop.prefecture, shop.city].filter(Boolean).join(" ");
const appLink = (prefecture, keyword) =>
  `/?${new URLSearchParams({ prefecture, ...(keyword ? { keyword } : {}) })}`;
const prefPath = (prefecture) => `/area/${prefectureSlugs.get(prefecture)}/`;
/**
 * 市区町村のページの URL（#341）。県・系列と同じく英字にする。名前は総務省の一覧の読みから作る
 * （名古屋市 → nagoya。data/municipalities.mjs の citySlugs）。一覧に無い名前ではページを作らずに止める。
 */
const slugsOf = new Map();
const cityPath = (prefecture, city) => {
  if (!slugsOf.has(prefecture)) slugsOf.set(prefecture, citySlugs(municipalities, prefecture));
  const slug = slugsOf.get(prefecture).get(city);
  if (!slug)
    throw new Error(
      `市区町村の英字の名前がありません: ${prefecture}${city}（data/municipalities.json）`,
    );
  return `${prefPath(prefecture)}${slug}/`;
};
const shopPath = (shop) => `/shop/${shop.id.replace("/", "-")}/`;

/**
 * 共有されたときのカード。トップ（index.html）と同じ画像を使い、文言はそのページの
 * title と description に合わせる（新しい情報は足さない）。
 */
const ogp = ({ title, description, path }) =>
  `<meta property="og:type" content="website"><meta property="og:locale" content="ja_JP"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${origin}${path}"><meta property="og:image" content="${origin}/og-card.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${origin}/og-card.png">`;

/** 見えているリンクと同じ階層。最後の 1 つはそのページ自身。 */
const breadcrumbs = (items) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], index) => ({
    "@type": "ListItem",
    position: index + 1,
    name,
    item: `${origin}${path}`,
  })),
});

/** 店が全部未判定なら、そのページも未判定の店と同じく検索に載せない。 */
const allCandidates = (list) => list.every((shop) => shop.confidence === "candidate");
/**
 * 市区町村ページは、未判定でない店が 2 軒未満なら載せない（#169）。1 軒だけのページは中身が
 * その店のページとほぼ同じ（違うのは見出しとパンくずだけ）で、店のページの方が載る。
 * 県ページからのリンクは残す（noindex でもリンクはたどられる）。
 */
const thinCity = (list) => list.filter((shop) => shop.confidence !== "candidate").length < 2;

/*
 * トップと同じ部品と見た目にする（#152）。ロゴと名前・探し方のリンク・見出しと件数の札・
 * 券売機の入口（茶赤の発券キー）・食券の形の店のカード。検索から来た人が最初に見るページで、
 * 下線のリンクが並ぶだけだと別のサイトに見えて離れた。静的なまま（Worker で毎回作らない）。
 */
/**
 * 静的なページの上のヘッダー（丼のロゴ＋ナビ）。都道府県・店のページと /connect（scripts/build/build-seo.mjs）が使う。
 * 家系マッチ・家系カメラ・診断はパソコン幅だけ見せ、スマホ幅では下のタブバー（#194）に任せる。
 */
export function siteHeader(path) {
  return `<header class="seo-header"><a class="seo-brand" href="/"><img src="/favicon.svg" alt="" width="40" height="40">家系ラーメンを探す</a><nav class="seo-links" aria-label="探し方"><a href="/">迷ったら</a><a href="/area/"${path === "/area/" ? ' aria-current="page"' : ""}>都道府県から</a><a class="seo-feature" href="/match/">家系マッチ</a><a class="seo-feature" href="/camera/">家系カメラ</a><a class="seo-feature" href="/shindan/">診断</a></nav></header>`;
}

/**
 * 見出しの HTML（#205）。**文節の切れ目は推し量らず、呼ぶ側が配列で渡す**（地名・店名を 1 つの
 * 区切りに入れ、中で割らない）。区切りの間だけ <wbr> にし、seo.css の keep-all でそこでだけ
 * 折り返す。Safari は word-break: auto-phrase を持たないので、こうして明示する。
 * ひらがなと漢字の境目から推し量ると、「しゃかりき|家」「さいたま|市」と固有名詞を割った。
 */
const phrases = (heading) => [heading].flat().map(escape).join("<wbr>");

function page({
  title,
  description,
  path,
  content,
  noindex = false,
  canonical = true,
  structured,
  heading = title,
  count,
  crumbs = "",
  tab = "search",
}) {
  const ld = [structured ?? []].flat();
  return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escape(title)}</title><meta name="description" content="${escape(description)}">${canonical ? `<link rel="canonical" href="${origin}${path}">${ogp({ title, description, path })}` : ""}${noindex ? '<meta name="robots" content="noindex">' : ""}<link rel="icon" href="/favicon-96.png" type="image/png" sizes="96x96"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180"><link rel="stylesheet" href="/seo-tokens.css"><link rel="stylesheet" href="/seo.css">${ld.length ? `<script type="application/ld+json">${JSON.stringify(ld.length === 1 ? ld[0] : ld).replace(/</g, "\\u003c")}</script>` : ""}</head><body class="seo-page">${siteHeader(path)}<main>${crumbs ? `<p class="seo-crumbs">${crumbs}</p>` : ""}<div class="seo-head"><h1>${phrases(heading)}</h1>${count === undefined ? "" : `<span class="seo-count">${count} 軒</span>`}</div>${content}</main><footer><p class="seo-note">店舗データ: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>（<a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL</a>）。個別に確認した補正を含む場合があります。一部の店は系列の公式の店舗一覧から足し、位置は国土地理院の住所検索か、系列の公式の店舗データによります。</p>${legalLinksHtml()}</footer>${tabBarHtml(tab)}</body></html>`;
}

/**
 * 主のボタン 1 つ（#255）。押したら何が起きるかを名前で言うので、券売機の見出しと小さい文字は付けない。
 * 外へ出るもの（Google マップ）は新しいタブで開く。
 */
function primary(href, label, external = false) {
  return `<a class="seo-primary" href="${escape(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escape(label)}</a>`;
}

/** 近い順に n 軒（直線距離）。自分は除く。 */
function nearest(shop, shops, n) {
  return shops
    .filter((other) => other.id !== shop.id)
    .map((other) => ({ other, km: distanceKm(shop.lat, shop.lon, other.lat, other.lon) }))
    .toSorted((a, b) => a.km - b.km)
    .slice(0, n);
}

/** 店のページの中身（#255）。行き先 → 注文のしかた → 近い家系 → 報告 → この情報について。 */
function shopContent(shop, shops, record) {
  const facts = [
    shop.openingHours && ["営業時間", openingHoursLabel(shop.openingHours)],
    shop.phone && ["電話", domesticPhone(shop.phone)],
  ].filter(Boolean);
  const factList = facts.length
    ? `<dl class="seo-facts">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd><b>${escape(value)}</b><small>（地図の記載）</small></dd></div>`).join("")}</dl>`
    : "";
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${shop.lat}%2C${shop.lon}`;
  const near = nearest(shop, shops, NEARBY)
    .map(
      ({ other, km }) =>
        `<li><a class="seo-near" href="${shopPath(other)}"><span><strong>${escape(other.name)}</strong><span>${escape(other.city ?? other.prefecture)}</span></span><b>${formatDistance(km)}</b></a></li>`,
    )
    .join("");
  const report = `<section class="seo-report" aria-labelledby="report-title" data-report-shop="${escape(shop.id)}"><h2 id="report-title">この店の情報、違っていませんか？</h2><div class="seo-report-buttons">${REPORT_KINDS.map(({ kind, label }) => `<button type="button" data-kind="${kind}">${escape(label)}</button>`).join("")}</div><p class="seo-note">サインインは不要です。押すとすぐ送られます。</p><p class="seo-report-status" role="status"></p></section>`;
  const about = `<section class="seo-about" aria-labelledby="about-title"><h2 id="about-title">この情報について</h2><dl>${[["家系かどうか", basisLabel(record)], ...ABOUT].map(([term, text]) => `<div><dt>${term}</dt><dd>${escape(text)}</dd></div>`).join("")}</dl></section>`;
  return `<p class="seo-lead">${escape([region(shop), shop.address].filter(Boolean).join(" "))}</p>${factList}<div class="seo-actions">${primary(directions, "Google マップで道順を見る", true)}<a class="seo-secondary" href="/guide/">注文のしかたを見る<small>お好み・卓上・ライス</small></a></div><h2 class="seo-section">この店から近い家系（直線距離）</h2><ul class="seo-nearby">${near}</ul>${report}${about}<script src="/shop-report.js" defer></script>`;
}

/** 店の一覧。但し書きは一覧のすぐ下に 1 回。 */
function shopList(shops) {
  return `<h2 class="seo-section">店舗</h2>${cards(shops)}<p class="seo-caveat">${note}</p>`;
}

/**
 * 県のページの店の一覧（#317）。区切りが無いと「横浜家系ラーメン」が続き、目当ての市が
 * どこから始まるか分からなかった。市区町村の見出しで区切り、上のチップからページの中で移る。
 * 市区町村のページへのリンクは見出しの横に残す。
 */
function cityShopList(groups) {
  return `<h2 class="seo-section">店舗</h2>${groups.map(({ id, href, city, shops }) => `<section class="seo-city" id="${id}"><div class="seo-city-head"><h3>${escape(city)}<span>${shops.length} 軒</span></h3>${href ? `<a class="seo-sub-link" href="${href}">${escape(city)}のページ</a>` : ""}</div>${cards(shops)}</section>`).join("")}<p class="seo-caveat">${note}</p>`;
}

/** 店のカード（食券の形）。 */
function cards(shops) {
  return `<ul class="seo-cards">${shops.map((shop) => `<li><a class="seo-card" href="${shopPath(shop)}"><strong>${escape(shop.name)}</strong><span>${escape([region(shop), shop.address].filter(Boolean).join(" "))}</span></a></li>`).join("")}</ul>`;
}

/**
 * 頼み方のページ（/guide/、#342）の中身。アプリの「注文のしかた」と同じ源（order-guide.ts）から作り、
 * ここに文言を書き足さない。一般的な作法で、店ごとの決まりではない（但し書きを中身のすぐ下に出す）。
 */
const answers = (rows) =>
  `<dl class="seo-guide">${rows.map(([term, value, why]) => `<div><dt>${escape(term)}</dt><dd><b>${escape(value)}</b><span>${escape(why)}</span></dd></div>`).join("")}</dl>`;
const guideContent = () =>
  `<p class="seo-lead">食券を渡すと「お好みは？」と聞かれることがあります。答え方と、回数ごとの頼み方をまとめました。</p><h2 class="seo-section">「お好みは？」と聞かれたら</h2>${answers(PREFERENCES.map((p) => [p.label, p.options.join(" / "), p.note]))}<h2 class="seo-section">回数ごとの頼み方</h2><p class="seo-note">順に ${PREFERENCES.map(({ label }) => label).join("・")}。</p>${answers(ORDER_SETS.map(({ label, choice, why }) => [label, choice.join(" / "), why]))}<h2 class="seo-section">券売機と卓上</h2><ul class="seo-guide-tips">${SIDE_TIPS.map((tip) => `<li>${escape(tip)}</li>`).join("")}</ul><p class="seo-caveat">${escape(ORDER_DISCLAIMER)}</p><div class="seo-actions">${primary("/", "近くの 3 軒を出す")}<a class="seo-secondary" href="/area/">都道府県から探す</a></div>`;

/** 地域のチップ。「判定した結果の〇軒」を行ごとに繰り返さず、軒数だけ添える。 */
function chips(items) {
  return `<ul class="seo-chips">${items.map(({ href, label, count }) => `<li><a href="${href}">${escape(label)}<span>${count} 軒</span></a></li>`).join("")}</ul>`;
}

/** 説明文の締め。営業時間は地図の記載がある店にしか出ないので、1 軒も無い地域では挙げない（#306）。 */
const reach = (list) =>
  `住所・${list.some((shop) => shop.openingHours) ? "営業時間・" : ""}Google マップの道順まで。`;

/**
 * 系列のページの URL（#326）。県と同じく英字にする（日本語だと貼ったときに %E7… になり読めない）。
 * 表記は系列の公式サイトのドメイン・英字表記に合わせ、無ければヘボン式（吉村家）。
 * 表に無い系列のページは作れないようにして、日本語の URL に戻さない。
 */
const chainSlugs = new Map([
  ["町田商店", "machida-shoten"],
  ["壱角家", "ichikakuya"],
  ["魂心家", "konshinya"],
  ["松壱家", "matsuichiya"],
  ["大和家", "yamatoya"],
  ["王道家", "oudouya"],
  ["壱八家", "ippachiya"],
  ["吉村家", "yoshimuraya"],
  ["杉田家", "sugitaya"],
]);
const chainPath = (chain) => {
  const slug = chainSlugs.get(chain);
  if (!slug)
    throw new Error(`系列の英字の名前がありません: ${chain}（seo-pages.mjs の chainSlugs に足す）`);
  return `/chain/${slug}/`;
};
const chainLead =
  "系列の公式の店舗一覧で確かめた店です。違う店を見つけたら、店のページから教えてください。";
/** 系列のページは店が 2 軒から作る（#309）。1 軒だけだと中身が店のページとほぼ同じになる（#169 と同じ考え）。 */
const CHAIN_MIN = 2;

/** 「2026-10-26」→「10月26日」。 */
const monthDay = (date) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
/** 確かめた先と日付。種類だけ書き、オーナーの実食など公開しない先は書かない（#345）。 */
const checkedAt = (record) =>
  `${CHECKED_AT[record.source] ? `${CHECKED_AT[record.source]}${/[A-Za-z]$/.test(CHECKED_AT[record.source]) ? " " : ""}で` : ""}確かめた（${record.checked}）`;

/** 開店・閉店の 1 行。今のデータにある店は店のページへつなぐ。 */
const newsItem = ({ kind, record, shop }) => {
  const name = shop?.name ?? record.name ?? "";
  const where = [shop?.prefecture ?? record.prefecture, shop?.city, shop?.address ?? record.address]
    .filter(Boolean)
    .join(" ");
  const what =
    kind === "opened"
      ? `${monthDay(record.opened)}に開店（公式に書いてある開店日）。${checkedAt(record)}`
      : kind === "found"
        ? `開店を${checkedAt(record)}。開店日は公式に書いてありません`
        : `閉店を${checkedAt(record)}`;
  const title = shop ? `<a href="${shopPath(shop)}">${escape(name)}</a>` : escape(name);
  return `<li><strong>${title}</strong><span>${escape(where)}</span><span>${escape(what)}</span></li>`;
};
// 県のページの市区町村の区切り（#317）と同じ見出しの形。月（h2）より小さく見せる。
const newsSection = (label, list) =>
  list.length
    ? `<section class="seo-city"><div class="seo-city-head"><h3>${label}<span>${list.length} 軒</span></h3></div><ul class="seo-news">${list.map(newsItem).join("")}</ul></section>`
    : "";

/**
 * 公式で確かめた開店・閉店（/new/、#345）。verified.json の記録から作り、手で書かない。
 * 開店は `opened` のある記録、閉店は `status: closed` の記録。月ごとに並べ、開店日が公式に書いてある店は
 * その月に、書いていない店（`opened: true`）と閉店は確かめた月に置く。「開いた店」と書くのは、公式の開店日が
 * その月の店だけ（それ以外は「開店を確かめた店」）。開店前の店は opened を持たないので載らない。
 */
function newShopsPage(records, shops, today) {
  const shopIds = new Set(shops.map((shop) => shop.id));
  const shopOf = new Map(shops.map((shop) => [shop.id, shop]));
  const entries = records.flatMap((record) => {
    const kind =
      record.status === "closed"
        ? "closed"
        : record.status === "open" && typeof record.opened === "string"
          ? "opened"
          : record.status === "open" && record.opened === true
            ? "found"
            : undefined;
    if (!kind) return [];
    const id = recordShopId(record);
    const shop = shopOf.get(id);
    const month = (kind === "opened" ? record.opened : record.checked).slice(0, 7);
    return [{ kind, record, month, shop: shopIds.has(id) ? shop : undefined }];
  });
  const months = [...new Set(entries.map((e) => e.month))].toSorted().toReversed();
  const thisMonth = today.toISOString().slice(0, 7);
  const body = months
    .map((month) => {
      const inMonth = entries.filter((e) => e.month === month);
      const of = (kind) => inMonth.filter((e) => e.kind === kind);
      return `<h2 class="seo-section">${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月${month === thisMonth ? "（今月）" : ""}</h2>${newsSection("開いた店", of("opened"))}${newsSection("開店を確かめた店", of("found"))}${newsSection("閉店を確かめた店", of("closed"))}`;
    })
    .join("");
  return page({
    title: "家系ラーメンの開店・閉店｜公式の情報で確かめた店を月ごとに",
    heading: ["家系ラーメンの", "開店・閉店"],
    description:
      "系列の公式の店舗一覧などで開店・閉店を確かめた家系ラーメンを、月ごとに並べています。開店日は公式に書いてあるときだけ載せます。",
    path: "/new/",
    crumbs: `<a href="/area/">都道府県</a>`,
    content: `<p class="seo-lead">公式の情報で開店・閉店を確かめた店です。開店前の店は載せません。開店日は公式に書いてあるときだけ出し、無ければ確かめた日を出します。</p>${body || '<p class="seo-note">まだありません。</p>'}<p class="seo-caveat">${note}</p>`,
  });
}

/**
 * WorkerのAPIへ変更を加えず、ビルド時にだけHTMLとsitemapを生成する。
 * `recordOf` は店 ID → 公式の情報で確かめた記録（verified.json の `status: open`）。
 * 系列のページ（#309）と、店のページの「家系かどうか」（#316）に使う。
 * 系列は店名から推した `brand` では決めない（記録と 25 軒食い違う）。
 * `records` は verified.json の全部の記録（閉店を含む）。開店・閉店のページ（#345）に使う。
 */
export function seoPages(shops, recordOf = new Map(), records = [], today = new Date()) {
  const files = new Map();
  const indexed = ["/", "/match/", "/camera/", "/shindan/", "/area/", "/guide/", "/new/"];
  files.set("/new/", newShopsPage(records, shops, today));
  const prefs = new Map();
  const cities = new Map();
  const chains = new Map();
  const ids = new Set();
  const titles = new Map();
  for (const shop of shops) {
    if (
      !prefectureSlugs.has(shop.prefecture) ||
      !/^(?:node|way|relation)\/\d+$|^(?:manual|verified)\/[0-9a-f]{20}$/.test(shop.id) ||
      ids.has(shop.id)
    )
      throw new Error("SEO用の店舗IDまたは都道府県が不正です");
    if (shop.city && (/[\\/]/.test(shop.city) || /^\.+$/.test(shop.city)))
      throw new Error("SEO用の市区町村名が不正です");
    ids.add(shop.id);
    const pref = prefs.get(shop.prefecture) ?? [];
    pref.push(shop);
    prefs.set(shop.prefecture, pref);
    if (shop.city) {
      const key = cityPath(shop.prefecture, shop.city);
      const group = cities.get(key) ?? [];
      group.push(shop);
      cities.set(key, group);
    }
    const record = recordOf.get(shop.id);
    const chain = record?.basis === "chain" ? record.chain : undefined;
    if (chain) {
      chains.set(chain, [...(chains.get(chain) ?? []), shop]);
    }
    const title = `${shop.name}｜${[region(shop), shop.address].filter(Boolean).join(" ")}｜家系ラーメンの店舗情報`;
    titles.set(title, (titles.get(title) ?? 0) + 1);
  }
  const prefLinks = chips(
    [...prefs]
      .toSorted(([a], [b]) => ALL_PREFECTURES.indexOf(a) - ALL_PREFECTURES.indexOf(b))
      .map(([name, list]) => ({ href: prefPath(name), label: name, count: list.length })),
  );
  const chainList = [...chains]
    .filter(([, list]) => list.length >= CHAIN_MIN)
    .toSorted(([, a], [, b]) => b.length - a.length);
  const chainLinks = chainList.length
    ? `<h2 class="seo-section" id="chains">系列</h2>${chips(chainList.map(([name, list]) => ({ href: chainPath(name), label: name, count: list.length })))}`
    : "";
  files.set(
    "/area/",
    page({
      title: `家系ラーメン ${shops.length}軒｜都道府県と地図から探す`,
      heading: ["都道府県から", "家系ラーメンを", "探す"],
      description: `家系ラーメン${shops.length}軒を都道府県から探せます。今いる場所から近い 3 軒を地図で出すこともできます。`,
      path: "/area/",
      count: shops.length,
      content: `${primary("/", "近くの 3 軒を出す")}<h2 class="seo-section">都道府県</h2>${prefLinks}${chainLinks}<p><a class="seo-sub-link" href="/new/">公式で確かめた開店・閉店</a></p><p class="seo-caveat">${note}</p>`,
    }),
  );
  files.set(
    "/guide/",
    page({
      title: "家系ラーメンの頼み方｜初めての「お好みは？」の答え方",
      heading: ["家系ラーメンの", "頼み方"],
      description:
        "家系ラーメンに初めて行く人のために、「お好みは？」と聞かれたときの答え方（麺の硬さ・味の濃さ・脂の量）と、回数ごとの頼み方、券売機と卓上のことをまとめました。",
      path: "/guide/",
      content: guideContent(),
    }),
  );
  for (const [chain, list] of chainList) {
    const path = chainPath(chain);
    const byPref = Map.groupBy(
      list.toSorted(
        (a, b) => ALL_PREFECTURES.indexOf(a.prefecture) - ALL_PREFECTURES.indexOf(b.prefecture),
      ),
      (shop) => shop.prefecture,
    );
    const anchor = (prefecture) => `pref-${prefectureSlugs.get(prefecture)}`;
    files.set(
      path,
      page({
        // 系列名で調べる人は「店舗一覧」と打つので先に出す（#340）。運営元の公式サイトと
        // 間違えさせないよう、説明文に出どころと、運営元のサイトではないことを書く。
        title: `${chain}の店舗一覧（${list.length}軒）｜都道府県ごとに探せる家系ラーメン`,
        heading: [`${chain}の`, "家系ラーメン", "店舗一覧"],
        description: `${chain}の店舗一覧（${list.length}軒）を都道府県ごとに探せます。系列の公式の店舗一覧で確かめた店を載せています（運営元のサイトではありません）。${reach(list)}`,
        path,
        count: list.length,
        crumbs: `<a href="/area/#chains">系列</a>`,
        content: `<p class="seo-lead">${chainLead}</p>${chips([...byPref].map(([prefecture, group]) => ({ href: `#${anchor(prefecture)}`, label: prefecture, count: group.length })))}${[...byPref].map(([prefecture, group]) => `<h2 class="seo-section" id="${anchor(prefecture)}">${escape(prefecture)}</h2>${cards(group)}`).join("")}<p class="seo-caveat">${note}</p>`,
      }),
    );
    indexed.push(path);
  }
  for (const [prefecture, list] of prefs) {
    const path = prefPath(prefecture);
    // 軒数の多い順（同数は名前順）。チップと一覧の見出しを同じ順に並べる（#317）。
    const groups = [...cities]
      .filter(([, group]) => group[0].prefecture === prefecture)
      .toSorted(([, a], [, b]) => b.length - a.length || a[0].city.localeCompare(b[0].city, "ja"))
      .map(([href, group], i) => ({
        id: `city-${i + 1}`,
        href,
        city: group[0].city,
        shops: group,
      }));
    // 市区町村の無い店（手動で足した店など）も県の一覧から落とさない。地名は作らず、ページへのリンクも付けない。
    const noCity = list.filter((shop) => !shop.city);
    if (noCity.length > 0)
      groups.push({ id: `city-${groups.length + 1}`, city: "市区町村の記載なし", shops: noCity });
    const cityLinks = chips(
      groups.map((group) => ({
        href: `#${group.id}`,
        label: group.city,
        count: group.shops.length,
      })),
    );
    files.set(
      path,
      page({
        title: `${prefecture}の家系ラーメン ${list.length}軒｜地図と市区町村から探す`,
        heading: [`${prefecture}の`, "家系ラーメン"],
        description: `${prefecture}の家系ラーメン${list.length}軒を地図と市区町村から探せます。${reach(list)}`,
        path,
        noindex: allCandidates(list),
        count: list.length,
        crumbs: `<a href="/area/">都道府県</a>`,
        content: `<p class="seo-lead">${listLead}</p><div class="seo-actions">${primary(`/?${new URLSearchParams({ prefecture, view: "map" })}`, `${prefecture}の地図を開く`)}<a class="seo-secondary" href="${escape(appLink(prefecture))}">${prefecture}から 3 軒に絞る</a></div><h2 class="seo-section">市区町村</h2>${cityLinks}${cityShopList(groups)}<p><a class="seo-sub-link" href="/guide/">初めての人へ: 家系ラーメンの頼み方</a></p>`,
      }),
    );
    if (!allCandidates(list)) indexed.push(path);
  }
  for (const [path, list] of cities) {
    const { prefecture, city } = list[0];
    const label = `${prefecture} ${city}`;
    files.set(
      path,
      page({
        title: `${label}の家系ラーメン ${list.length}軒｜地図と店舗一覧から探す`,
        heading: [`${prefecture} `, `${city}の`, "家系ラーメン"],
        description: `${label}の家系ラーメン${list.length}軒を地図と店舗一覧から探せます。${reach(list)}`,
        path,
        noindex: thinCity(list),
        structured: breadcrumbs([
          [prefecture, prefPath(prefecture)],
          [city, path],
        ]),
        count: list.length,
        crumbs: `<a href="/area/">都道府県</a> / <a href="${prefPath(prefecture)}">${escape(prefecture)}</a>`,
        content: `<p class="seo-lead">${listLead}</p>${primary(appLink(prefecture, city), `${city}の店を一覧で見る`)}${shopList(list)}`,
      }),
    );
    if (!thinCity(list)) indexed.push(path);
  }
  for (const shop of shops) {
    const path = shopPath(shop);
    const baseTitle = `${shop.name}｜${[region(shop), shop.address].filter(Boolean).join(" ")}｜家系ラーメンの店舗情報`;
    const title = `${baseTitle}${titles.get(baseTitle) > 1 ? `（${shop.lat}, ${shop.lon}）` : ""}`;
    const address = {
      "@type": "PostalAddress",
      addressRegion: shop.prefecture,
      ...(shop.city ? { addressLocality: shop.city } : {}),
      ...(shop.address ? { streetAddress: shop.address } : {}),
      addressCountry: "JP",
    };
    const structured = {
      "@context": "https://schema.org",
      "@type": "Restaurant",
      name: shop.name,
      address,
      geo: { "@type": "GeoCoordinates", latitude: shop.lat, longitude: shop.lon },
    };
    files.set(
      path,
      page({
        title,
        description: `${shop.name}の店舗情報。地域は${[region(shop), shop.address].filter(Boolean).join(" ")}。地図の位置を確認できます。`,
        path,
        heading: shop.name,
        noindex: shop.confidence === "candidate",
        structured: [
          structured,
          breadcrumbs([
            [shop.prefecture, prefPath(shop.prefecture)],
            ...(shop.city ? [[shop.city, cityPath(shop.prefecture, shop.city)]] : []),
            [shop.name, path],
          ]),
        ],
        crumbs: `<a href="/area/">都道府県</a> / <a href="${prefPath(shop.prefecture)}">${escape(shop.prefecture)}</a>${shop.city ? ` / <a href="${cityPath(shop.prefecture, shop.city)}">${escape(shop.city)}</a>` : ""}`,
        content: shopContent(shop, shops, recordOf.get(shop.id)),
      }),
    );
    if (shop.confidence !== "candidate") indexed.push(path);
  }
  // 存在しない URL で Worker が返すページ（#169）。どこにも載せず、行き先だけ示す。
  files.set(
    "/404.html",
    page({
      title: "ページが見つかりません｜家系ラーメンを探す",
      description: "お探しのページは見つかりませんでした。",
      path: "/404.html",
      heading: ["ページが", "見つかりません"],
      noindex: true,
      canonical: false,
      content: `<p class="seo-lead">URL が変わったか、店舗の情報が更新された可能性があります。</p>${primary("/", "近くの 3 軒を出す")}<p><a class="seo-sub-link" href="/area/">都道府県から探す</a></p>`,
    }),
  );
  files.set(
    "/sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${indexed.map((path) => `<url><loc>${escape(origin + path)}</loc></url>`).join("")}</urlset>`,
  );
  files.set("/robots.txt", `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
  return {
    files,
    // #309 で日本語の URL で公開した分を、英字の URL へ 301 で送る（public/_redirects に足す）。
    // _redirects は届いたままの（%E7… の）パスと突き合わせるので、エンコードした形で書く。
    redirects: [
      ...chainList.flatMap(([chain]) =>
        ["/", ""].map((end) => [`/chain/${encodeURIComponent(chain)}${end}`, chainPath(chain)]),
      ),
      // 市区町村のページも、日本語の URL で公開した分を英字の URL へ送る（#341）。
      ...[...cities].flatMap(([path, [{ prefecture, city }]]) =>
        ["/", ""].map((end) => [`${prefPath(prefecture)}${encodeURIComponent(city)}${end}`, path]),
      ),
    ],
    counts: {
      prefectures: prefs.size,
      municipalities: cities.size,
      shops: shops.length,
      indexed: indexed.length,
    },
  };
}

/**
 * プライバシーポリシーと利用規約（#198）。正本は docs/legal/*.md で、ここでは HTML にするだけ。
 * `/privacy.html` に置くと、静的アセットが `/privacy` で返す（/connect と同じ）。
 */
export function legalPages({ privacy, terms }) {
  const files = new Map();
  for (const [path, markdown, description] of [
    ["/privacy", privacy, "家系ラーメンを探すが受け取る情報と、その使い道・保存・外部への送信"],
    ["/terms", terms, "家系ラーメンを探すの利用条件"],
  ]) {
    const { title, html } = legalMarkdown(markdown);
    if (!title || /【/.test(title + html))
      throw new Error(`${path}: 見出しが無いか、【】が残っています`);
    files.set(
      `${path}.html`,
      page({
        title: `${title}｜家系ラーメンを探す`,
        description,
        path,
        heading: title,
        content: `<div class="seo-legal">${html}</div>`,
        // どのタブの中身でもないので、タブは選ばない（/connect と同じ）。
        tab: null,
      }),
    );
  }
  return files;
}
