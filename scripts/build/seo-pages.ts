import { tabBarHtml } from "../../src/utils/tabbar.ts";
import { legalLinksHtml } from "../../src/utils/legal-links.ts";
import { legalMarkdown } from "./legal-markdown.ts";
import { citySlugs } from "../data/municipalities.ts";
import municipalities from "../../data/municipalities.json" with { type: "json" };
import { recordShopId } from "../data/verified-shops.ts";
import { ALL_PREFECTURES } from "../../src/utils/prefectures.ts";
import { SHOP_ID, shopSlug } from "../../src/utils/shop-id.ts";
import { distanceKm, formatDistance } from "../../src/utils/geo.ts";
import { openingHoursLabel } from "../../src/utils/opening-hours.ts";
import {
  ORDER_DISCLAIMER,
  ORDER_SETS,
  PREFERENCES,
  SIDE_TIPS,
} from "../../src/utils/order-guide.ts";
import type { Shop } from "../../src/types/index.ts";
import type { TabKey } from "../../src/utils/tabbar.ts";

/** 公式の情報で確かめた記録（data/verified.json の 1 件）のうち、ここで読む欄。 */
export interface VerifiedRecord {
  id?: string;
  status: string;
  basis: string;
  chain?: string;
  source: string;
  url?: string;
  checked: string;
  /** 公式に書いてある開店日（YYYY-MM-DD）。開店日が書いていない店は true。 */
  opened?: string | true;
  name?: string;
  prefecture?: string;
  address?: string;
}
/** 市区町村のある店。市区町村のページに載る。 */
type CityShop = Shop & { city: string };
/** 県のページの市区町村の区切り。 */
interface CityGroup {
  id: string;
  href?: string;
  city: string;
  shops: Shop[];
}
/** 開店・閉店のページの 1 行。 */
interface NewsEntry {
  kind: "opened" | "found" | "closed";
  record: VerifiedRecord;
  month: string;
  shop?: Shop;
}
/** 「この情報について」の行。`[見出し, 文字, HTML]`。 */
type AboutRow = [string, string, string?];

const origin = "https://iekeiramen.com";
const slugs =
  "hokkaido aomori iwate miyagi akita yamagata fukushima ibaraki tochigi gunma saitama chiba tokyo kanagawa niigata toyama ishikawa fukui yamanashi nagano gifu shizuoka aichi mie shiga kyoto osaka hyogo nara wakayama tottori shimane okayama hiroshima yamaguchi tokushima kagawa ehime kochi fukuoka saga nagasaki kumamoto oita miyazaki kagoshima okinawa".split(
    " ",
  );
const prefectureSlugs = new Map<string, string>(
  ALL_PREFECTURES.map((name, index) => [name, slugs[index]]),
);
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
/** 確かめた先の言い方。記録の `url` は、店のページに確かめた先へのリンクとして出す（#367）。 */
const CHECKED_AT: Record<string, string> = {
  "chain-list": "系列の公式の店舗一覧",
  "official-site": "店の公式サイト",
  "official-sns": "店の公式 SNS",
  "official-release": "運営会社の発表",
};
/**
 * 「家系かどうか」の欄（#316）。公式の情報で確かめた記録（`status: open`）がある店は、
 * 確かめた先と日付を書く。記録が無い店は推定のまま。
 */
const basisLabel = (record?: VerifiedRecord) => {
  if (record?.status !== "open" || !CHECKED_AT[record.source]) return ESTIMATED;
  const where = `${CHECKED_AT[record.source]}${/[A-Za-z]$/.test(CHECKED_AT[record.source]) ? " " : ""}`;
  // 公式に家系の名乗りが無い店（#389）。公式で確かめたのは営業だけなので、家系と確かめたようには書かない。
  return record.basis === "owner"
    ? `公式に家系の名乗りは無く、運営者の判断（営業は${where}で確かめた。${record.checked}）`
    : `${where}で確かめた（${record.checked}）`;
};
const TASTE_NOTE = ["味の分類", "既知のブランドからの参考値（食べて決めたものではありません）"];
const REPORT_NOTE = ["違っていたら", "上の「この店の情報、違っていませんか？」から"];
/**
 * 確かめた先へのリンク（#367）。自分たちで公式と確かめた記録（`status: open`）の `url` だけを出す。
 * 外のサイトなので新しいタブで開き、そのことを文字でも書く。http(s) 以外は出さない。
 */
const sourceLink = (record?: VerifiedRecord) =>
  record?.status === "open" && CHECKED_AT[record.source] && /^https?:\/\//.test(record.url ?? "")
    ? `<a href="${escape(record.url)}" target="_blank" rel="noopener noreferrer">${CHECKED_AT[record.source]}${/[A-Za-z]$/.test(CHECKED_AT[record.source]) ? " " : ""}を開く</a><small>（別のサイト・新しいタブ）</small>`
    : undefined;
/**
 * 「この情報について」の行（#255・#367）。項目は `[見出し, 文字, HTML]`（HTML は escape しない）。
 * 営業時間・電話の行は、地図に記載があるときだけ出す（無いものを「地図の記載」と書かない）。
 */
function aboutRows(shop: Shop, record?: VerifiedRecord) {
  const link = sourceLink(record);
  const hasFacts = Boolean(shop.openingHours || shop.phone);
  return [
    ["家系かどうか", basisLabel(record)],
    link && ["公式の情報", "", link],
    TASTE_NOTE,
    hasFacts && [
      "営業時間・電話",
      `地図の記載。変わることがあるので、行く前に${link ? "上の公式の情報か、" : ""}店の公式情報で確かめてください`,
    ],
    REPORT_NOTE,
  ].filter(Boolean) as AboutRow[];
}
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
export const domesticPhone = (raw: string) =>
  raw
    .trim()
    .replace(/^\+81[\s-]*0?/, "0")
    .replace(/\s+/g, "-");
/** 近い家系の数（#255）。行き止まりにしないため。多く並べると、どれも同じ重さに見える。 */
const NEARBY = 3;
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<
          string,
          string
        >
      )[character],
  );
const region = (shop: Shop) => [shop.prefecture, shop.city].filter(Boolean).join(" ");
const appLink = (prefecture: string) => `/?${new URLSearchParams({ prefecture })}`;
const prefPath = (prefecture: string) => `/area/${prefectureSlugs.get(prefecture)}/`;
/**
 * 市区町村のページの URL（#341）。県・系列と同じく英字にする。名前は総務省の一覧の読みから作る
 * （名古屋市 → nagoya。data/municipalities.ts の citySlugs）。一覧に無い名前ではページを作らずに止める。
 */
const slugsOf = new Map<string, Map<string, string>>();
const cityPath = (prefecture: string, city: string) => {
  if (!slugsOf.has(prefecture)) slugsOf.set(prefecture, citySlugs(municipalities, prefecture));
  const slug = slugsOf.get(prefecture)!.get(city);
  if (!slug)
    throw new Error(
      `市区町村の英字の名前がありません: ${prefecture}${city}（data/municipalities.json）`,
    );
  return `${prefPath(prefecture)}${slug}/`;
};
const shopPath = (shop: Shop) => `/shop/${shopSlug(shop.id)}/`;

/**
 * 共有されたときのカード。トップ（index.html）と同じ画像を使い、文言はそのページの
 * title と description に合わせる（新しい情報は足さない）。
 */
const ogp = ({ title, description, path }: { title: string; description: string; path: string }) =>
  `<meta property="og:type" content="website"><meta property="og:locale" content="ja_JP"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${origin}${path}"><meta property="og:image" content="${origin}/og-card.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${origin}/og-card.png">`;

/** 見えているリンクと同じ階層。最後の 1 つはそのページ自身。 */
const breadcrumbs = (items: string[][]) => ({
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
const allCandidates = (list: Shop[]) => list.every((shop) => shop.confidence === "candidate");
/**
 * 市区町村ページは、未判定でない店が 2 軒未満なら載せない（#169）。1 軒だけのページは中身が
 * その店のページとほぼ同じ（違うのは見出しとパンくずだけ）で、店のページの方が載る。
 * 県ページからのリンクは残す（noindex でもリンクはたどられる）。
 */
const thinCity = (list: Shop[]) =>
  list.filter((shop) => shop.confidence !== "candidate").length < 2;

/*
 * トップと同じ部品と見た目にする（#152）。ロゴと名前・探し方のリンク・見出しと件数の札・
 * 券売機の入口（茶赤の発券キー）・食券の形の店のカード。検索から来た人が最初に見るページで、
 * 下線のリンクが並ぶだけだと別のサイトに見えて離れた。静的なまま（Worker で毎回作らない）。
 */
/**
 * 静的なページの上のヘッダー（丼のロゴ＋ナビ）。都道府県・店のページと /connect（scripts/build/build-seo.ts）が使う。
 * 家系マッチ・家系カメラ・診断はパソコン幅だけ見せ、スマホ幅では下のタブバー（#194）に任せる。
 */
export function siteHeader(path: string) {
  return `<header class="seo-header"><a class="seo-brand" href="/"><img src="/favicon.svg" alt="" width="40" height="40">家系ラーメンを探す</a><nav class="seo-links" aria-label="探し方"><a href="/">迷ったら</a><a href="/area/"${path === "/area/" ? ' aria-current="page"' : ""}>都道府県から</a><a class="seo-feature" href="/match/">家系マッチ</a><a class="seo-feature" href="/camera/">家系カメラ</a><a class="seo-feature" href="/shindan/">診断</a></nav></header>`;
}

/**
 * 見出しの HTML（#205）。**文節の切れ目は推し量らず、呼ぶ側が配列で渡す**（地名・店名を 1 つの
 * 区切りに入れ、中で割らない）。区切りの間だけ <wbr> にし、seo.css の keep-all でそこでだけ
 * 折り返す。Safari は word-break: auto-phrase を持たないので、こうして明示する。
 * ひらがなと漢字の境目から推し量ると、「しゃかりき|家」「さいたま|市」と固有名詞を割った。
 */
const phrases = (heading: string | string[]) => [heading].flat().map(escape).join("<wbr>");

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
}: {
  title: string;
  description: string;
  path: string;
  content: string;
  noindex?: boolean;
  canonical?: boolean;
  structured?: object | object[];
  heading?: string | string[];
  count?: number;
  crumbs?: string;
  tab?: TabKey | null;
}) {
  const ld = [structured ?? []].flat();
  return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escape(title)}</title><meta name="description" content="${escape(description)}">${canonical ? `<link rel="canonical" href="${origin}${path}">${ogp({ title, description, path })}` : ""}${noindex ? '<meta name="robots" content="noindex">' : ""}<link rel="icon" href="/favicon-96.png" type="image/png" sizes="96x96"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180"><link rel="stylesheet" href="/seo-tokens.css"><link rel="stylesheet" href="/seo.css">${ld.length ? `<script type="application/ld+json">${JSON.stringify(ld.length === 1 ? ld[0] : ld).replace(/</g, "\\u003c")}</script>` : ""}</head><body class="seo-page">${siteHeader(path)}<main>${crumbs ? `<p class="seo-crumbs">${crumbs}</p>` : ""}<div class="seo-head"><h1>${phrases(heading)}</h1>${count === undefined ? "" : `<span class="seo-count">${count} 軒</span>`}</div>${content}</main><footer><p class="seo-note">店舗データ: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>（<a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL</a>）。個別に確認した補正を含む場合があります。一部の店は系列の公式の店舗一覧から足し、位置は国土地理院の住所検索か、系列の公式の店舗データによります。</p>${legalLinksHtml()}</footer>${tabBarHtml(tab ?? undefined)}</body></html>`;
}

/**
 * 主のボタン 1 つ（#255）。押したら何が起きるかを名前で言うので、券売機の見出しと小さい文字は付けない。
 * 外へ出るもの（Google マップ）は新しいタブで開く。
 */
function primary(href: string, label: string, external = false) {
  return `<a class="seo-primary" href="${escape(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escape(label)}</a>`;
}

/** 近い順に n 軒（直線距離）。自分は除く。 */
function nearest(shop: Shop, shops: Shop[], n: number) {
  return shops
    .filter((other) => other.id !== shop.id)
    .map((other) => ({ other, km: distanceKm(shop.lat, shop.lon, other.lat, other.lon) }))
    .toSorted((a, b) => a.km - b.km)
    .slice(0, n);
}

/**
 * 店のページの説明文（#382）。そのページに実際に出ているものだけを挙げる。営業時間・電話は
 * 地図に記載がある店だけ、公式の情報は確かめた記録（`status: open`）のリンクがある店だけ。
 */
export function shopDescription(shop: Shop, shops: Shop[], record?: VerifiedRecord) {
  const facts = [shop.openingHours && "営業時間", shop.phone && "電話番号"].filter(Boolean);
  const items = [
    facts.length && `${facts.join("・")}（地図の記載）`,
    sourceLink(record) && "公式の情報へのリンク",
    "Google マップの道順",
    nearest(shop, shops, NEARBY).length && "近くの家系（直線距離）",
  ].filter(Boolean);
  return `${shop.name}の店舗情報。地域は${[region(shop), shop.address].filter(Boolean).join(" ")}。${items.join("、")}を載せています。`;
}

/**
 * 店のページの中身（#255）。行き先 → 注文のしかた → 近い家系 → 報告 → この情報について。
 * 系列のページに載る店だけ、近い家系の下にその系列の一覧へのリンクを置く（#381）。
 */
function shopContent(
  shop: Shop,
  shops: Shop[],
  record?: VerifiedRecord,
  chain?: { name: string; count: number },
) {
  const facts = [
    shop.openingHours && ["営業時間", openingHoursLabel(shop.openingHours)],
    shop.phone && ["電話", domesticPhone(shop.phone)],
  ].filter(Boolean) as [string, string][];
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
  const report = `<section class="seo-report" aria-labelledby="report-title" data-report-shop="${escape(shop.id)}"><h2 id="report-title">この店の情報、違っていませんか？</h2><div class="seo-report-buttons">${REPORT_KINDS.map(({ kind, label }) => `<button type="button" data-kind="${kind}">${escape(label)}</button>`).join("")}</div><div class="seo-report-confirm" hidden><p class="seo-report-question"></p><div class="seo-report-buttons"><button type="button" data-confirm>送る</button><button type="button" data-cancel>やめる</button></div></div><p class="seo-note">サインインは不要です。押すと、送る前に確かめます。</p><p class="seo-report-status" role="status" tabindex="-1"></p></section>`;
  const about = `<section class="seo-about" aria-labelledby="about-title"><h2 id="about-title">この情報について</h2><dl>${aboutRows(
    shop,
    record,
  )
    .map(([term, text, html]) => `<div><dt>${term}</dt><dd>${html ?? escape(text)}</dd></div>`)
    .join("")}</dl></section>`;
  return `<p class="seo-lead">${escape([region(shop), shop.address].filter(Boolean).join(" "))}</p>${factList}<div class="seo-actions">${primary(directions, "Google マップで道順を見る", true)}<a class="seo-secondary" href="/guide/">注文のしかたを見る<small>お好み・卓上・ライス</small></a></div><h2 class="seo-section">この店から近い家系（直線距離）</h2><ul class="seo-nearby">${near}</ul>${chain ? `<p class="seo-back"><a class="seo-sub-link" href="${chainPath(chain.name)}">${escape(chain.name)}の店舗一覧（${chain.count} 軒）</a></p>` : ""}${report}${about}<script src="/shop-report.js" defer></script>`;
}

/** 店の一覧。但し書きは一覧のすぐ下に 1 回。 */
/** 住所の町名の順（#424）。同じ町の店が並び、行き先の近くの店を目で拾える。 */
const byAddress = (a: Shop, b: Shop) =>
  (a.address ?? "").localeCompare(b.address ?? "", "ja") || a.name.localeCompare(b.name, "ja");

/** 「保土ヶ谷区」と「保土ケ谷区」のように、ヶ・ケの書き分けを同じに見る。 */
const sameKe = (text: string) => text.replaceAll("ヶ", "ケ");
/** 政令市の区の名前（data/municipalities.json の「横浜市保土ケ谷区」など）。長い名前から当てる。 */
const wardsOf = (prefecture: string, city: string) =>
  Object.keys((municipalities as Record<string, Record<string, string>>)[prefecture] ?? {})
    .filter((name) => name.startsWith(city) && name.endsWith("区") && name.length > city.length)
    .map((name) => name.slice(city.length))
    .toSorted((a, b) => b.length - a.length);
/**
 * 住所の頭に書かれた区（政令市）。区の名前は data/municipalities.json の一覧と突き合わせる
 * （漢字だけで読むと保土ケ谷区を落とした。#424 の Codex の指摘）。書かれていなければ無し。座標などから推測して足さない。
 */
const wardOf = (shop: Shop) =>
  shop.city
    ? wardsOf(shop.prefecture, shop.city).find((ward) =>
        sameKe(shop.address ?? "").startsWith(sameKe(ward)),
      )
    : undefined;

/**
 * 市区町村のページの店の一覧（#424）。店は住所の町名の順。政令市で住所に区がある店は、区の見出しでまとめる
 * （軒数の多い順。県のページの市区町村と同じ並べ方）。区の無い店は最後の「区の記載なし」にまとめ、1 軒も落とさない。
 * 区のチップは付けない。チップが 1 画面目を占めると、最初の店が画面の外へ出る（#423 と同じ理由）。
 */
function shopList(shops: Shop[]) {
  const sorted = shops.toSorted(byAddress);
  const wards = Map.groupBy(
    sorted.filter((shop) => wardOf(shop)),
    (shop) => wardOf(shop)!,
  );
  const groups = [...wards].toSorted(
    ([a, x], [b, y]) => y.length - x.length || a.localeCompare(b, "ja"),
  );
  const noWard = sorted.filter((shop) => !wardOf(shop));
  if (groups.length > 0 && noWard.length > 0) groups.push(["区の記載なし", noWard]);
  const list =
    groups.length === 0
      ? cards(sorted)
      : groups
          .map(
            ([ward, group]) =>
              `<section class="seo-city"><div class="seo-city-head"><h3>${escape(ward)}<span>${group.length} 軒</span></h3></div>${cards(group)}</section>`,
          )
          .join("");
  return `<h2 class="seo-section">店舗</h2>${list}<p class="seo-caveat">${note}</p>`;
}

/**
 * 県のページの店の一覧（#317）。区切りが無いと「横浜家系ラーメン」が続き、目当ての市が
 * どこから始まるか分からなかった。市区町村の見出しで区切り、上のチップからページの中で移る。
 * 市区町村のページへのリンクは見出しの横に残す。
 */
function cityShopList(groups: CityGroup[]) {
  return `<h2 class="seo-section">店舗</h2>${groups.map(({ id, href, city, shops }) => `<section class="seo-city" id="${id}"><div class="seo-city-head"><h3>${escape(city)}<span>${shops.length} 軒</span></h3>${href ? `<a class="seo-sub-link" href="${href}">${escape(city)}のページ</a>` : ""}</div>${cards(shops)}${backTo(groups, "市区町村")}</section>`).join("")}<p class="seo-caveat">${note}</p>`;
}

/**
 * 長い一覧の区切りの最後に置く、上のチップへ戻るリンク（#368）。県・系列のページは 2 万 px 近くあり、
 * 途中まで読むと別の市・県へ移る手段が無かった。浮かせたボタンにはしない（動きは控えめ・本文の邪魔をしない）。
 * 区切りが 2 つ以下なら、戻るほどの長さが無いので出さない。
 */
const JUMP_ID = "jump";
const backTo = (groups: readonly unknown[], label: string) =>
  groups.length > 2
    ? `<p class="seo-back"><a class="seo-sub-link" href="#${JUMP_ID}">${label}の一覧へ戻る</a></p>`
    : "";

/** 店のカード（食券の形）。 */
function cards(shops: Shop[]) {
  return `<ul class="seo-cards">${shops.map((shop) => `<li><a class="seo-card" href="${shopPath(shop)}"><strong>${escape(shop.name)}</strong><span>${escape([region(shop), shop.address].filter(Boolean).join(" "))}</span></a></li>`).join("")}</ul>`;
}

/**
 * 頼み方のページ（/guide/、#342）の中身。アプリの「注文のしかた」と同じ源（order-guide.ts）から作り、
 * ここに文言を書き足さない。一般的な作法で、店ごとの決まりではない（但し書きを中身のすぐ下に出す）。
 */
const answers = (rows: string[][]) =>
  `<dl class="seo-guide">${rows.map(([term, value, why]) => `<div><dt>${escape(term)}</dt><dd><b>${escape(value)}</b><span>${escape(why)}</span></dd></div>`).join("")}</dl>`;
const guideContent = () =>
  `<p class="seo-lead">食券を渡すと「お好みは？」と聞かれることがあります。答え方と、回数ごとの頼み方をまとめました。</p><h2 class="seo-section">「お好みは？」と聞かれたら</h2>${answers(PREFERENCES.map((p) => [p.label, p.options.join(" / "), p.note]))}<h2 class="seo-section">回数ごとの頼み方</h2><p class="seo-note">順に ${PREFERENCES.map(({ label }) => label).join("・")}。</p>${answers(ORDER_SETS.map(({ label, choice, why }) => [label, choice.join(" / "), why]))}<h2 class="seo-section">券売機と卓上</h2><ul class="seo-guide-tips">${SIDE_TIPS.map((tip) => `<li>${escape(tip)}</li>`).join("")}</ul><p class="seo-caveat">${escape(ORDER_DISCLAIMER)}</p><div class="seo-actions">${primary("/", "近くの 3 軒を出す")}<a class="seo-secondary" href="/area/">都道府県から探す</a></div>`;

/** 地域のチップ。「判定した結果の〇軒」を行ごとに繰り返さず、軒数だけ添える。 */
function chips(items: { href: string; label: string; count: number }[]) {
  return `<ul class="seo-chips">${items.map(({ href, label, count }) => `<li><a href="${href}">${escape(label)}<span>${count} 軒</span></a></li>`).join("")}</ul>`;
}

/** 説明文の締め。営業時間は地図の記載がある店にしか出ないので、1 軒も無い地域では挙げない（#306）。 */
const reach = (list: Shop[]) =>
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
const chainPath = (chain: string) => {
  const slug = chainSlugs.get(chain);
  if (!slug)
    throw new Error(`系列の英字の名前がありません: ${chain}（seo-pages.ts の chainSlugs に足す）`);
  return `/chain/${slug}/`;
};
const chainLead =
  "系列や店の公式の情報で確かめた店です。違う店を見つけたら、店のページから教えてください。";
/** 系列のページは店が 2 軒から作る（#309）。1 軒だけだと中身が店のページとほぼ同じになる（#169 と同じ考え）。 */
const CHAIN_MIN = 2;
/**
 * 都道府県のチップを一覧の上に出すのは、この軒数より多い系列だけ（#423）。
 * 王道家（14 軒）でチップが 1 画面目を占め、「店舗一覧」で来た人が開いてすぐ店を見られなかった。
 * 今の系列は 196・137・51 軒と 14 軒以下に分かれるので、その間の 20 で分ける。
 */
const CHAIN_CHIPS_OVER = 20;

/** 「2026-10-26」→「10月26日」。 */
const monthDay = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
/** 確かめた先と日付。種類だけ書き、オーナーの実食など公開しない先は書かない（#345）。 */
const checkedAt = (record: VerifiedRecord) =>
  `${CHECKED_AT[record.source] ? `${CHECKED_AT[record.source]}${/[A-Za-z]$/.test(CHECKED_AT[record.source]) ? " " : ""}で` : ""}確かめた（${record.checked}）`;

/** 開店・閉店の 1 行。今のデータにある店は店のページへつなぐ。 */
const newsItem = ({ kind, record, shop }: NewsEntry) => {
  const name = shop?.name ?? record.name ?? "";
  const where = [shop?.prefecture ?? record.prefecture, shop?.city, shop?.address ?? record.address]
    .filter(Boolean)
    .join(" ");
  const what =
    kind === "opened"
      ? `${monthDay(record.opened as string)}に開店（公式に書いてある開店日）。${checkedAt(record)}`
      : kind === "found"
        ? `開店を${checkedAt(record)}。開店日は公式に書いてありません`
        : `閉店を${checkedAt(record)}`;
  const title = shop ? `<a href="${shopPath(shop)}">${escape(name)}</a>` : escape(name);
  return `<li><strong>${title}</strong><span>${escape(where)}</span><span>${escape(what)}</span></li>`;
};
// 県のページの市区町村の区切り（#317）と同じ見出しの形。月（h2）より小さく見せる。
const newsSection = (label: string, list: NewsEntry[]) =>
  list.length
    ? `<section class="seo-city"><div class="seo-city-head"><h3>${label}<span>${list.length} 軒</span></h3></div><ul class="seo-news">${list.map(newsItem).join("")}</ul></section>`
    : "";

/**
 * 公式で確かめた開店・閉店（/new/、#345）。verified.json の記録から作り、手で書かない。
 * 開店は `opened` のある記録、閉店は `status: closed` の記録。月ごとに並べ、開店日が公式に書いてある店は
 * その月に、書いていない店（`opened: true`）と閉店は確かめた月に置く。「開いた店」と書くのは、公式の開店日が
 * その月の店だけ（それ以外は「開店を確かめた店」）。開店前の店は opened を持たないので載らない。
 * /new/ には今月を含む直近 3 か月だけを出し、それより前は月ごとのページ /new/YYYY-MM/ に出す（#358）。
 */
const NEW_RECENT_MONTHS = 3;
const newLead =
  '<p class="seo-lead">公式の情報で開店・閉店を確かめた店です。開店前の店は載せません。開店日は公式に書いてあるときだけ出し、無ければ確かめた日を出します。</p>';
const monthLabel = (month: string) =>
  `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`;

function newsEntries(records: VerifiedRecord[], shops: Shop[]): NewsEntry[] {
  const shopIds = new Set(shops.map((shop) => shop.id));
  const shopOf = new Map(shops.map((shop) => [shop.id, shop]));
  return records.flatMap((record) => {
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
    const month = (kind === "opened" ? (record.opened as string) : record.checked).slice(0, 7);
    return [{ kind, record, month, shop: shopIds.has(id) ? shop : undefined }];
  });
}

const newsMonth = (inMonth: NewsEntry[], heading: string) => {
  const of = (kind: NewsEntry["kind"]) => inMonth.filter((e) => e.kind === kind);
  return `<h2 class="seo-section">${heading}</h2>${newsSection("開いた店", of("opened"))}${newsSection("開店を確かめた店", of("found"))}${newsSection("閉店を確かめた店", of("closed"))}`;
};

/**
 * トップ（index.html）の下に置く、検索で読める本文（#435）。トップは開いてから画面を描く作りで、
 * 最初の HTML の本文が 38 文字（リンク 3 つ）しか無かった。中身は /area/ と /new/ と同じ源から作り、手で書かない。
 * 画面のいちばん下（アプリの後）に置くので、1 画面目（現在地から近い 3 軒）と動きは変わらない。
 * 但し書き（推定・参考値）はここに置かない。トップではアプリの 3 軒のすぐ下に 1 回出ている（#152 の「1 回」を守る）。
 * 開店・閉店は、ビルドした月を「2026年11月」のように書く（「今月」と書くと、次のデプロイまでに古くなる）。
 */
function homeSection({
  count,
  prefLinks,
  chainChips,
  records,
  shops,
  today,
}: {
  count: number;
  prefLinks: string;
  chainChips: string;
  records: VerifiedRecord[];
  shops: Shop[];
  today: Date;
}) {
  const month = today.toISOString().slice(0, 7);
  const inMonth = newsEntries(records, shops).filter((entry) => entry.month === month);
  const of = (kind: NewsEntry["kind"]) => inMonth.filter((entry) => entry.kind === kind);
  const news = inMonth.length
    ? `${newsSection("開いた店", of("opened"))}${newsSection("開店を確かめた店", of("found"))}${newsSection("閉店を確かめた店", of("closed"))}`
    : '<p class="seo-note">この月は、まだありません。</p>';
  return `<section class="seo-home" aria-labelledby="home-title"><h2 class="seo-section" id="home-title">家系ラーメン ${count} 軒を、地域と系列から探す</h2><p class="seo-lead">今いる場所から近い家系ラーメンを 3 軒まで出し、地図と一覧で探せます。距離は直線距離です。${listLead}</p><h3 class="seo-home-sub">都道府県</h3>${prefLinks}${chainChips ? `<h3 class="seo-home-sub">系列</h3>${chainChips}` : ""}<h2 class="seo-section">${monthLabel(month)}の開店・閉店</h2>${news}<ul class="seo-home-links"><li><a href="/new/">公式で確かめた開店・閉店をもっと見る</a></li><li><a href="/area/">都道府県から家系ラーメンを探す</a></li><li><a href="/guide/">家系ラーメンの頼み方（お好み・卓上・ライス）</a></li><li><a href="/connect">チャットで使う方法</a></li></ul></section>`;
}

/** /new/ と、過ぎた月のページ（path → HTML）。 */
function newShopsPages(records: VerifiedRecord[], shops: Shop[], today: Date) {
  const entries = newsEntries(records, shops);
  const months = [...new Set(entries.map((e) => e.month))].toSorted().toReversed();
  const inMonth = (month: string) => entries.filter((e) => e.month === month);
  const thisMonth = today.toISOString().slice(0, 7);
  const first = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (NEW_RECENT_MONTHS - 1), 1),
  );
  const oldest = first.toISOString().slice(0, 7);
  const recent = months.filter((month) => month >= oldest);
  const past = months.filter((month) => month < oldest);
  const pages = new Map<string, string>();
  for (const month of past) {
    const label = monthLabel(month);
    pages.set(
      `/new/${month}/`,
      page({
        title: `家系ラーメンの開店・閉店（${label}）｜公式の情報で確かめた店`,
        heading: ["家系ラーメンの", `開店・閉店（${label}）`],
        description: `${label}に開店・閉店を、系列の公式の店舗一覧などで確かめた家系ラーメンです。開店日は公式に書いてあるときだけ載せます。`,
        path: `/new/${month}/`,
        crumbs: `<a href="/area/">都道府県</a> / <a href="/new/">開店・閉店</a>`,
        content: `${newLead}${newsMonth(inMonth(month), label)}<p class="seo-caveat">${note}</p>`,
      }),
    );
  }
  const body = recent
    .map((month) =>
      newsMonth(inMonth(month), `${monthLabel(month)}${month === thisMonth ? "（今月）" : ""}`),
    )
    .join("");
  const archive = past.length
    ? `<h2 class="seo-section">それより前の月</h2>${chips(past.map((month) => ({ href: `/new/${month}/`, label: monthLabel(month), count: inMonth(month).length })))}`
    : "";
  pages.set(
    "/new/",
    page({
      title: "家系ラーメンの開店・閉店｜公式の情報で確かめた店を月ごとに",
      heading: ["家系ラーメンの", "開店・閉店"],
      description:
        "系列の公式の店舗一覧などで開店・閉店を確かめた家系ラーメンを、月ごとに並べています。開店日は公式に書いてあるときだけ載せます。",
      path: "/new/",
      crumbs: `<a href="/area/">都道府県</a>`,
      content: `${newLead}${body || '<p class="seo-note">ここ 3 か月はまだありません。</p>'}${archive}<p class="seo-caveat">${note}</p>`,
    }),
  );
  return pages;
}

/**
 * WorkerのAPIへ変更を加えず、ビルド時にだけHTMLとsitemapを生成する。
 * `recordOf` は店 ID → 公式の情報で確かめた記録（verified.json の `status: open`）。
 * 系列のページ（#309）と、店のページの「家系かどうか」（#316）に使う。
 * 系列は店名から推した `brand` では決めない（記録と 25 軒食い違う）。
 * `records` は verified.json の全部の記録（閉店を含む）。開店・閉店のページ（#345）に使う。
 */
export function seoPages(
  shops: Shop[],
  recordOf = new Map<string, VerifiedRecord>(),
  records: VerifiedRecord[] = [],
  today = new Date(),
) {
  const files = new Map<string, string>();
  const indexed = ["/", "/match/", "/camera/", "/shindan/", "/area/", "/guide/"];
  for (const [path, html] of newShopsPages(records, shops, today)) {
    files.set(path, html);
    indexed.push(path);
  }
  const prefs = new Map<string, Shop[]>();
  const cities = new Map<string, CityShop[]>();
  const chains = new Map<string, Shop[]>();
  const ids = new Set<string>();
  const titles = new Map<string, number>();
  for (const shop of shops) {
    if (!prefectureSlugs.has(shop.prefecture) || !SHOP_ID.test(shop.id) || ids.has(shop.id))
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
      group.push(shop as CityShop);
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
      .toSorted(
        ([a], [b]) =>
          (ALL_PREFECTURES as readonly string[]).indexOf(a) -
          (ALL_PREFECTURES as readonly string[]).indexOf(b),
      )
      .map(([name, list]) => ({ href: prefPath(name), label: name, count: list.length })),
  );
  const chainList = [...chains]
    .filter(([, list]) => list.length >= CHAIN_MIN)
    .toSorted(([, a], [, b]) => b.length - a.length);
  // 系列のページに載る店（#361 の決まりで選んだ店）だけが、店のページから系列へリンクする（#381）。
  const chainOf = new Map<string, { name: string; count: number }>(
    chainList.flatMap(([name, list]) =>
      list.map((shop) => [shop.id, { name, count: list.length }]),
    ),
  );
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
        (a, b) =>
          (ALL_PREFECTURES as readonly string[]).indexOf(a.prefecture) -
          (ALL_PREFECTURES as readonly string[]).indexOf(b.prefecture),
      ),
      (shop) => shop.prefecture,
    );
    const anchor = (prefecture: string) => `pref-${prefectureSlugs.get(prefecture)}`;
    files.set(
      path,
      page({
        // 系列名で調べる人は「店舗一覧」と打つので先に出す（#340）。運営元の公式サイトと
        // 間違えさせないよう、説明文に出どころと、運営元のサイトではないことを書く。
        title: `${chain}の店舗一覧（${list.length}軒）｜都道府県ごとに探せる家系ラーメン`,
        heading: [`${chain}の`, "家系ラーメン", "店舗一覧"],
        description: `${chain}の店舗一覧（${list.length}軒）を都道府県ごとに探せます。系列や店の公式の情報で確かめた店を載せています（運営元のサイトではありません）。${reach(list)}`,
        path,
        count: list.length,
        crumbs: `<a href="/area/#chains">系列</a>`,
        // 「〇〇 近く」で来た人が、自分の県まで読み進めずに近い店へ行けるように（#368）。
        // 店の少ない系列はチップを出さず、ボタンのすぐ下から店の一覧にする（#423）。戻るリンクもチップへ戻るものなので出さない。
        content: `<p class="seo-lead">${chainLead}</p><div class="seo-actions">${primary(`/?${new URLSearchParams({ keyword: chain, view: "three" })}`, `近くの${chain}を出す`)}</div>${list.length > CHAIN_CHIPS_OVER ? `<h2 class="seo-section" id="${JUMP_ID}">都道府県</h2>${chips([...byPref].map(([prefecture, group]) => ({ href: `#${anchor(prefecture)}`, label: prefecture, count: group.length })))}` : ""}${[...byPref].map(([prefecture, group]) => `<h2 class="seo-section" id="${anchor(prefecture)}">${escape(prefecture)}</h2>${cards(group)}${list.length > CHAIN_CHIPS_OVER ? backTo([...byPref], "都道府県") : ""}`).join("")}<p class="seo-caveat">${note}</p>`,
      }),
    );
    indexed.push(path);
  }
  for (const [prefecture, list] of prefs) {
    const path = prefPath(prefecture);
    // 軒数の多い順（同数は名前順）。チップと一覧の見出しを同じ順に並べる（#317）。
    const groups: CityGroup[] = [...cities]
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
        content: `<p class="seo-lead">${listLead}</p><div class="seo-actions">${primary(`/?${new URLSearchParams({ prefecture, view: "map" })}`, `${prefecture}の地図を開く`)}<a class="seo-secondary" href="${escape(appLink(prefecture))}">${prefecture}から 3 軒に絞る</a></div><h2 class="seo-section" id="${JUMP_ID}">市区町村</h2>${cityLinks}${cityShopList(groups)}<p><a class="seo-sub-link" href="/guide/">初めての人へ: 家系ラーメンの頼み方</a></p>`,
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
        // ボタンは県のページと同じ 2 つ（#368）。一覧はこのページの下にあるので、アプリの一覧へは送らない。
        content: `<p class="seo-lead">${listLead}</p><div class="seo-actions">${primary(`/?${new URLSearchParams({ prefecture, keyword: city, view: "map" })}`, `${city}の地図を開く`)}<a class="seo-secondary" href="${escape(`/?${new URLSearchParams({ prefecture, keyword: city, view: "three" })}`)}">${city}から 3 軒に絞る</a></div>${shopList(list)}`,
      }),
    );
    if (!thinCity(list)) indexed.push(path);
  }
  for (const shop of shops) {
    const path = shopPath(shop);
    const baseTitle = `${shop.name}｜${[region(shop), shop.address].filter(Boolean).join(" ")}｜家系ラーメンの店舗情報`;
    const title = `${baseTitle}${titles.get(baseTitle)! > 1 ? `（${shop.lat}, ${shop.lon}）` : ""}`;
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
        description: shopDescription(shop, shops, recordOf.get(shop.id)),
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
        content: shopContent(shop, shops, recordOf.get(shop.id), chainOf.get(shop.id)),
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
    home: homeSection({
      count: shops.length,
      prefLinks,
      chainChips: chainList.length
        ? chips(
            chainList.map(([name, list]) => ({
              href: chainPath(name),
              label: name,
              count: list.length,
            })),
          )
        : "",
      records,
      shops,
      today,
    }),
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
export function legalPages({ privacy, terms }: { privacy: string; terms: string }) {
  const files = new Map<string, string>();
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
