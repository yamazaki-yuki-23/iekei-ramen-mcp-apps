import { ALL_PREFECTURES } from "../src/lib/prefectures.ts";

const origin = "https://iekeiramen.com";
const slugs =
  "hokkaido aomori iwate miyagi akita yamagata fukushima ibaraki tochigi gunma saitama chiba tokyo kanagawa niigata toyama ishikawa fukui yamanashi nagano gifu shizuoka aichi mie shiga kyoto osaka hyogo nara wakayama tottori shimane okayama hiroshima yamaguchi tokushima kagawa ehime kochi fukuoka saga nagasaki kumamoto oita miyazaki kagoshima okinawa".split(
    " ",
  );
const prefectureSlugs = new Map(ALL_PREFECTURES.map((name, index) => [name, slugs[index]]));
const note =
  '家系判定と味の傾向は地図データやブランドをもとにした推定です。味・営業状況の最新情報は店舗の公式情報で確認してください。家系ではない店が、家系として表示されている可能性があります。見つけたら、<a href="/">アプリ</a>でその店を開き「店舗情報を報告する」から教えてください。';
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

function page({ title, description, path, content, noindex = false, structured, heading = title }) {
  return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${origin}${path}">${noindex ? '<meta name="robots" content="noindex">' : ""}<link rel="icon" href="/favicon-96.png" type="image/png" sizes="96x96"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180"><link rel="stylesheet" href="/seo-tokens.css"><link rel="stylesheet" href="/seo.css">${structured ? `<script type="application/ld+json">${JSON.stringify(structured).replace(/</g, "\\u003c")}</script>` : ""}</head><body class="seo-page"><header class="seo-sign"><nav aria-label="サイト内"><a class="seo-brand" href="/"><img src="/favicon.svg" alt="" width="28" height="28">家系ラーメンを探す</a><a href="/area/">都道府県から探す</a></nav></header><main><h1>${escape(heading)}</h1>${content}<p class="seo-note">${note}</p></main><footer><p class="seo-note">店舗の基礎データ・地域情報の出典：© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>（<a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL</a>）。個別に確認した補正を含む場合があります。</p></footer></body></html>`;
}

function shopList(shops) {
  return `<ul>${shops.map((shop) => `<li><a class="seo-shop" href="${shopPath(shop)}">${escape(shop.name)}</a><p class="seo-note">${escape([region(shop), shop.address].filter(Boolean).join(" "))}</p></li>`).join("")}</ul>`;
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
  const prefLinks = [...prefs]
    .toSorted(([a], [b]) => ALL_PREFECTURES.indexOf(a) - ALL_PREFECTURES.indexOf(b))
    .map(
      ([name, list]) =>
        `<li><a href="${prefPath(name)}">${escape(name)}</a><p>判定した結果の${list.length}軒</p></li>`,
    )
    .join("");
  files.set(
    "/area/",
    page({
      title: "都道府県から家系ラーメンの候補を探す",
      description: `判定した結果の${shops.length}軒を都道府県から探せます。家系ではない店が含まれている可能性があります。`,
      path: "/area/",
      content: `<p>判定した結果の${shops.length}軒。家系ではない店が含まれている可能性があります。</p><ul>${prefLinks}</ul>`,
    }),
  );
  for (const [prefecture, list] of prefs) {
    const path = prefPath(prefecture);
    const cityLinks = [...cities]
      .filter(([, group]) => group[0].prefecture === prefecture)
      .map(
        ([city, group]) =>
          `<li><a href="${city}">${escape(group[0].city)}</a><p>判定した結果の${group.length}軒</p></li>`,
      )
      .join("");
    files.set(
      path,
      page({
        title: `${prefecture}の家系ラーメンの候補一覧`,
        description: `${prefecture}で判定した結果の${list.length}軒。店舗情報・地域と地図を確認できます。家系ではない店が含まれている可能性があります。`,
        path,
        content: `<p>判定した結果の${list.length}軒。家系ではない店が含まれている可能性があります。</p><a class="seo-app-link" href="${escape(appLink(prefecture))}">この都道府県の条件でアプリを開く</a><h2>市区町村から探す</h2><ul>${cityLinks}</ul><h2>店舗の候補</h2>${shopList(list)}`,
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
        content: `<p><a href="${prefPath(prefecture)}">${escape(prefecture)}の一覧</a></p><p>判定した結果の${list.length}軒。家系ではない店が含まれている可能性があります。</p><a class="seo-app-link" href="${escape(appLink(prefecture, city))}">この地域の条件でアプリを開く</a>${shopList(list)}`,
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
        content: `<p><a href="${prefPath(shop.prefecture)}">${escape(shop.prefecture)}の一覧</a>${shop.city ? ` / <a href="${cityPath(shop.prefecture, shop.city)}">${escape(shop.city)}の一覧</a>` : ""}</p><p>${escape([region(shop), shop.address].filter(Boolean).join(" "))}</p><p>座標：${shop.lat}, ${shop.lon}</p><p><a class="seo-app-link" href="${escape(map)}" target="_blank" rel="noopener noreferrer">地図で位置を見る</a></p><a class="seo-app-link" href="${escape(appLink(shop.prefecture, shop.name))}">この店名の条件でアプリを開く</a>`,
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
