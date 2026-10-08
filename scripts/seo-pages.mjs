import { ALL_PREFECTURES } from "../src/lib/prefectures.ts";

const origin = "https://iekeiramen.com";
const slugs =
  "hokkaido aomori iwate miyagi akita yamagata fukushima ibaraki tochigi gunma saitama chiba tokyo kanagawa niigata toyama ishikawa fukui yamanashi nagano gifu shizuoka aichi mie shiga kyoto osaka hyogo nara wakayama tottori shimane okayama hiroshima yamaguchi tokushima kagawa ehime kochi fukuoka saga nagasaki kumamoto oita miyazaki kagoshima okinawa".split(
    " ",
  );
const prefectureSlugs = new Map(ALL_PREFECTURES.map((name, index) => [name, slugs[index]]));
/*
 * 但し書きは一覧のすぐ下に 1 回（#152）。推定・誤りの報告の道・営業状況の確かめ方を
 * 1 段落にまとめる。アプリの ResultCaveat と同じ言い方にそろえる。
 */
const note =
  '家系かどうかは地図の記載と既知のブランドからの推定、味の傾向は既知のブランドからの参考値で、実食に基づくものではありません。営業状況は店舗の公式情報で確認してください。違う店があれば、<a href="/">アプリ</a>でその店を開き「店舗情報を報告する」から教えてください。';
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
const cityPath = (prefecture, city) => `${prefPath(prefecture)}${encodeURIComponent(city)}/`;
const shopPath = (shop) => `/shop/${shop.id.replace("/", "-")}/`;

/*
 * トップと同じ部品と見た目にする（#152）。ロゴと名前・探し方のリンク・見出しと件数の札・
 * 券売機の入口（茶赤の発券キー）・食券の形の店のカード。検索から来た人が最初に見るページで、
 * 下線のリンクが並ぶだけだと別のサイトに見えて離れた。静的なまま（Worker で毎回作らない）。
 */
function page({
  title,
  description,
  path,
  content,
  noindex = false,
  structured,
  heading = title,
  count,
  crumbs = "",
}) {
  return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${origin}${path}">${noindex ? '<meta name="robots" content="noindex">' : ""}<link rel="icon" href="/favicon-96.png" type="image/png" sizes="96x96"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180"><link rel="stylesheet" href="/seo-tokens.css"><link rel="stylesheet" href="/seo.css">${structured ? `<script type="application/ld+json">${JSON.stringify(structured).replace(/</g, "\\u003c")}</script>` : ""}</head><body class="seo-page"><header class="seo-header"><a class="seo-brand" href="/"><img src="/favicon.svg" alt="" width="40" height="40">家系ラーメンを探す</a><nav class="seo-links" aria-label="探し方"><a href="/">迷ったら</a><a href="/area/"${path === "/area/" ? ' aria-current="page"' : ""}>都道府県から</a></nav></header><main>${crumbs ? `<p class="seo-crumbs">${crumbs}</p>` : ""}<div class="seo-head"><h1>${escape(heading)}</h1>${count === undefined ? "" : `<span class="seo-count">判定した結果の ${count} 軒</span>`}</div>${content}</main><footer><p class="seo-note">店舗データ: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>（<a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL</a>）。個別に確認した補正を含む場合があります。</p></footer></body></html>`;
}

/** 券売機の入口。アプリの券売機と同じ枠に、茶赤の発券キーを 1 つ置く。 */
function machine(title, href, label, sub) {
  return `<section class="seo-machine" aria-label="${escape(title)}"><div class="seo-machine-top"><h2>${escape(title)}</h2><span>押して、発券</span></div><div class="seo-machine-panel"><a class="seo-issue" href="${escape(href)}">${escape(label)}<small>${escape(sub)}</small></a></div></section>`;
}

/** 店のカード（食券の形）。但し書きは一覧のすぐ下に 1 回。 */
function shopList(shops) {
  return `<h2 class="seo-section">店舗</h2><ul class="seo-cards">${shops.map((shop) => `<li><a class="seo-card" href="${shopPath(shop)}"><strong>${escape(shop.name)}</strong><span>${escape([region(shop), shop.address].filter(Boolean).join(" "))}</span></a></li>`).join("")}</ul><p class="seo-caveat">${note}</p>`;
}

/** 地域のチップ。「判定した結果の〇軒」を行ごとに繰り返さず、軒数だけ添える。 */
function chips(items) {
  return `<ul class="seo-chips">${items.map(({ href, label, count }) => `<li><a href="${href}">${escape(label)}<span>${count} 軒</span></a></li>`).join("")}</ul>`;
}

/** WorkerのAPIへ変更を加えず、ビルド時にだけHTMLとsitemapを生成する。 */
export function seoPages(shops) {
  const files = new Map();
  const indexed = ["/", "/area/"];
  const prefs = new Map();
  const cities = new Map();
  const ids = new Set();
  const titles = new Map();
  for (const shop of shops) {
    if (
      !prefectureSlugs.has(shop.prefecture) ||
      !/^(?:node|way|relation)\/\d+$|^manual\/[0-9a-f]{20}$/.test(shop.id) ||
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
    const title = `${shop.name}｜${[region(shop), shop.address].filter(Boolean).join(" ")}｜家系ラーメンの店舗情報`;
    titles.set(title, (titles.get(title) ?? 0) + 1);
  }
  const prefLinks = chips(
    [...prefs]
      .toSorted(([a], [b]) => ALL_PREFECTURES.indexOf(a) - ALL_PREFECTURES.indexOf(b))
      .map(([name, list]) => ({ href: prefPath(name), label: name, count: list.length })),
  );
  files.set(
    "/area/",
    page({
      title: "都道府県から家系ラーメンの候補を探す",
      description: `判定した結果の${shops.length}軒を都道府県から探せます。家系ではない店が含まれている可能性があります。`,
      path: "/area/",
      count: shops.length,
      content: `${machine("家系 券売機", "/", "近くで発券する", "推定した地域の 3 軒が出てきます")}<h2 class="seo-section">都道府県</h2>${prefLinks}<p class="seo-caveat">${note}</p>`,
    }),
  );
  for (const [prefecture, list] of prefs) {
    const path = prefPath(prefecture);
    const cityLinks = chips(
      [...cities]
        .filter(([, group]) => group[0].prefecture === prefecture)
        .map(([city, group]) => ({ href: city, label: group[0].city, count: group.length })),
    );
    files.set(
      path,
      page({
        title: `${prefecture}の家系ラーメンの候補一覧`,
        description: `${prefecture}で判定した結果の${list.length}軒。店舗情報・地域と地図を確認できます。家系ではない店が含まれている可能性があります。`,
        path,
        count: list.length,
        crumbs: `<a href="/area/">都道府県</a>`,
        content: `${machine(`${prefecture}の券売機`, appLink(prefecture), `${prefecture}で発券する`, "迷ったら、この中の 3 軒をアプリで")}<h2 class="seo-section">市区町村</h2>${cityLinks}${shopList(list)}`,
      }),
    );
    indexed.push(path);
  }
  for (const [path, list] of cities) {
    const { prefecture, city } = list[0];
    const label = `${prefecture} ${city}`;
    files.set(
      path,
      page({
        title: `${label}の家系ラーメンの候補一覧`,
        description: `${label}で判定した結果の${list.length}軒。店舗情報と地図を確認できます。家系ではない店が含まれている可能性があります。`,
        path,
        count: list.length,
        crumbs: `<a href="/area/">都道府県</a> / <a href="${prefPath(prefecture)}">${escape(prefecture)}</a>`,
        content: `${machine(`${city}の券売機`, appLink(prefecture, city), `${city}で探す`, "アプリで地図と一覧を開きます")}${shopList(list)}`,
      }),
    );
    indexed.push(path);
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
    };
    const structured = {
      "@context": "https://schema.org",
      "@type": "Restaurant",
      name: shop.name,
      address,
      geo: { "@type": "GeoCoordinates", latitude: shop.lat, longitude: shop.lon },
    };
    const map = `https://www.google.com/maps/search/?api=1&query=${shop.lat}%2C${shop.lon}`;
    files.set(
      path,
      page({
        title,
        description: `${shop.name}の店舗情報。地域は${[region(shop), shop.address].filter(Boolean).join(" ")}。地図の位置を確認できます。`,
        path,
        heading: shop.name,
        noindex: shop.confidence === "candidate",
        structured,
        crumbs: `<a href="/area/">都道府県</a> / <a href="${prefPath(shop.prefecture)}">${escape(shop.prefecture)}</a>${shop.city ? ` / <a href="${cityPath(shop.prefecture, shop.city)}">${escape(shop.city)}</a>` : ""}`,
        content: `<p class="seo-lead">${escape([region(shop), shop.address].filter(Boolean).join(" "))}</p>${machine("この店の券売機", appLink(shop.prefecture, shop.name), "この店をアプリで開く", "注文のしかたや、まわる店への追加ができます")}<p><a class="seo-sub-link" href="${escape(map)}" target="_blank" rel="noopener noreferrer">地図で位置を見る（Google マップ）</a></p><p class="seo-caveat">${note}</p>`,
      }),
    );
    if (shop.confidence !== "candidate") indexed.push(path);
  }
  files.set(
    "/sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${indexed.map((path) => `<url><loc>${escape(origin + path)}</loc></url>`).join("")}</urlset>`,
  );
  files.set("/robots.txt", `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
  return {
    files,
    counts: {
      prefectures: prefs.size,
      municipalities: cities.size,
      shops: shops.length,
      indexed: indexed.length,
    },
  };
}
