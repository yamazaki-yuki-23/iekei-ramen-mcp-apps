import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { domesticPhone, REPORT_KINDS, seoPages } from "../scripts/build/seo-pages.mjs";
import { ReportSchema } from "../src/lib/reports";
import { type Shop } from "../src/types";
import { CONFIDENCE } from "../src/utils/labels";
import { webEntry } from "../src/features/search/utils/web-entry";
import { ORDER_DISCLAIMER, ORDER_SETS, PREFERENCES, SIDE_TIPS } from "../src/utils/order-guide";

const shop: Shop = {
  id: "node/123",
  name: "試験家",
  confidence: "confirmed",
  taste: "unknown",
  prefecture: "神奈川県",
  city: "横浜市",
  address: "西区岡野",
  lat: 35.46,
  lon: 139.62,
  osmUrl: "https://www.openstreetmap.org/node/123",
};
const shops = [shop, { ...shop, id: "way/456", name: "未判定家", confidence: "candidate" }];

/** 1 軒でも未判定以外があれば、その一覧ページは検索に載せる。 */
const indexedPages = (list: Shop[]) => list.some((s) => s.confidence !== "candidate");

/** ページの JSON-LD を全部読む（1 つでも配列でも）。 */
function jsonLd(html: string): Record<string, unknown>[] {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  if (!raw) return [];
  const parsed = JSON.parse(raw) as Record<string, unknown> | Record<string, unknown>[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

describe("静的SEOページ", () => {
  it("県・市・店を生成し、未判定だけnoindexとsitemap除外にする", () => {
    const { files, counts } = seoPages(shops);
    // 市区町村は未判定でない店が 1 軒だけなので載せない（#169）。
    expect(counts).toEqual({ prefectures: 1, municipalities: 1, shops: 2, indexed: 9 });
    // 固定の 6 枚（トップ・家系マッチ #181・家系カメラ #242・家系タイプ診断 #167・都道府県の一覧・頼み方 #342）も載せる。
    expect(files.get("/sitemap.xml")).toContain("https://iekeiramen.com/match/");
    // 家系カメラも検索に載せる（#242）。見本の段階は終わった。
    expect(files.get("/sitemap.xml")).toContain("https://iekeiramen.com/camera/");
    expect(files.get("/area/kanagawa/")).toContain("神奈川県の家系ラーメン2軒");
    expect(files.get("/area/kanagawa/yokohama/")).toContain("未判定家");
    expect(files.get("/shop/node-123/")).not.toContain('name="robots" content="noindex"');
    expect(files.get("/shop/way-456/")).toContain('name="robots" content="noindex"');
    // スマホ幅の下のタブバー（#194）。「探す」がいまいる画面で、アイコンは線の svg。
    for (const path of ["/area/kanagawa/", "/shop/node-123/"]) {
      const html = files.get(path)!;
      expect(html).toContain('<nav class="tabbar" aria-label="機能" data-tabbar>');
      expect(html).toContain('<a href="/" aria-current="page"><svg');
      for (const href of ["/match/", "/camera/", "/shindan/"])
        expect(html).toContain(`<a href="${href}"><svg`);
      // パソコン幅では上のナビから開ける（スマホ幅では隠してタブバーに任せる）。
      for (const href of ["/match/", "/camera/", "/shindan/"])
        expect(html).toContain(`<a class="seo-feature" href="${href}">`);
    }
    expect(files.get("/sitemap.xml")).toContain("https://iekeiramen.com/shop/node-123/");
    expect(files.get("/sitemap.xml")).not.toContain("way-456");
    expect(files.get("/robots.txt")).toContain("Sitemap: https://iekeiramen.com/sitemap.xml");
  });
  it("判定の段階は出さず、誤りの可能性を但し書きで伝える（#144）", () => {
    const html = seoPages(shops).files.get("/area/kanagawa/")!;
    expect(html).not.toContain(CONFIDENCE.candidate.description);
    expect(html).not.toContain(CONFIDENCE.confirmed.label + "</span>");
    expect(html).toContain(
      "家系かどうかは地図の記載と既知のブランドからの推定（一部の店は公式の情報で確かめています）、味の傾向は既知のブランドからの参考値で、実食に基づくものではありません。",
    );
    // 段階を出さない代わりに、誤りを直す道（店のページの報告、#255）へ案内する。
    expect(html).toContain(
      "違う店があれば、その店のページの「この店の情報、違っていませんか？」から教えてください。",
    );
  });
  it("未信頼の文字列をHTMLとJSON-LDの両方で安全に扱い、JSON-LD に評価や営業時間を付けない", () => {
    const hostile = {
      ...shop,
      name: '</script><script>alert("x")</script>&',
      openingHours: "24/7",
      website: "https://example.com",
      phone: "00000000",
    };
    const html = seoPages([hostile]).files.get("/shop/node-123/")!;
    expect(html).not.toContain('</script><script>alert("x")');
    expect(html).toContain("&lt;/script&gt;");
    const structured = jsonLd(html).find((item) => item["@type"] === "Restaurant");
    expect(structured).toEqual({
      "@context": "https://schema.org",
      "@type": "Restaurant",
      name: hostile.name,
      address: {
        "@type": "PostalAddress",
        addressRegion: "神奈川県",
        addressLocality: "横浜市",
        streetAddress: "西区岡野",
        addressCountry: "JP",
      },
      geo: { "@type": "GeoCoordinates", latitude: 35.46, longitude: 139.62 },
    });
    expect(html).not.toContain("24/7");
  });
  it("市区町村がない手動追加店も県と店に載せ、重複店舗と危険なパスを拒否する", () => {
    const manual = {
      ...shop,
      id: "manual/0123456789abcdef0123",
      city: undefined,
      address: undefined,
    };
    const result = seoPages([manual]);
    expect(result.counts.municipalities).toBe(0);
    expect(result.files.has("/shop/manual-0123456789abcdef0123/")).toBe(true);
    // 県の一覧からも落とさない。地名は作らず、市区町村のページへのリンクも付けない（Codex の指摘、PR #319）。
    const pref = result.files.get("/area/kanagawa/")!;
    expect(pref).toContain('href="/shop/manual-0123456789abcdef0123/"');
    expect(pref).toContain("<h3>市区町村の記載なし<span>1 軒</span></h3></div>");
    expect(() => seoPages([shop, shop])).toThrow();
    expect(() => seoPages([{ ...shop, id: "../../mcp" }])).toThrow();
    expect(() => seoPages([{ ...shop, city: "../mcp" }])).toThrow();
  });
  it("実データの全HTMLに固有metadata・但し書き・出典・faviconがあり、APIの経路と重ならない", () => {
    const data = JSON.parse(
      readFileSync(new URL("../data/shops.json", import.meta.url), "utf8"),
    ) as Shop[];
    const { files, counts } = seoPages(data);
    const titles: string[] = [];
    const descriptions: string[] = [];
    const canonicals: string[] = [];
    for (const [path, html] of files) {
      if (!path.endsWith("/")) continue;
      expect(
        path === "/guide/" ||
          path === "/new/" ||
          path === "/area/" ||
          path.startsWith("/area/") ||
          path.startsWith("/shop/"),
      ).toBe(true);
      titles.push(html.match(/<title>(.*?)<\/title>/)![1]);
      descriptions.push(html.match(/name="description" content="([^"]*)"/)![1]);
      canonicals.push(html.match(/rel="canonical" href="([^"]*)"/)![1]);
      // 頼み方のページは店の一覧ではない。中身の但し書きは別の describe で見る（#342）。
      if (path === "/guide/") continue;
      expect(html).toContain("既知のブランドからの参考値");
      // 座標の行は出さない。利用者には意味が無く、地図のリンクで足りる（#152）。
      expect(html).not.toContain("座標：");
      // 但し書きと誤りの報告の案内は、どのページも 1 回だけ（#152）。
      expect(html.split("参考値").length - 1).toBe(1);
      // 報告の口（店のページはその場の報告、一覧は店のページへの案内）。
      expect(html).toContain("この店の情報、違っていませんか？");
      expect(html).toContain("OpenStreetMap contributors");
      expect(html).toContain("ODbL");
      expect(html).toContain('rel="icon"');
    }
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    expect(new Set(canonicals).size).toBe(canonicals.length);
    expect(counts.shops).toBe(data.length);
    const byPref = Map.groupBy(data, (s) => s.prefecture);
    const byCity = Map.groupBy(
      data.filter((s) => s.city),
      (s) => `${s.prefecture}/${s.city}`,
    );
    expect(counts.indexed).toBe(
      // トップ・マッチ・カメラ・診断・都道府県・頼み方・開店と閉店（#345）
      7 +
        [...byPref.values()].filter(indexedPages).length +
        // 市区町村は、未判定でない店が 2 軒以上のときだけ載せる（#169）。
        [...byCity.values()].filter(
          (list) => list.filter((s) => s.confidence !== "candidate").length >= 2,
        ).length +
        data.filter((s) => s.confidence !== "candidate").length,
    );
  });
});

const near = (id: string, name: string, lat: number) => ({ ...shop, id, name, lat });
const shopPage = (list: Shop[]) => seoPages(list).files.get("/shop/node-123/")!;

describe("初めて来た人向けの店のページ（#255）", () => {
  it("営業時間・電話は持っている店だけ、地図の記載と添えて出す", () => {
    const html = shopPage([{ ...shop, openingHours: "10:30-25:00", phone: "+81-0564-31-7060" }]);
    expect(html).toContain(
      "<dt>営業時間</dt><dd><b>10:30〜翌 1:00</b><small>（地図の記載）</small>",
    );
    expect(html).toContain("<dt>電話</dt><dd><b>0564-31-7060</b><small>（地図の記載）</small>");
    expect(shopPage([shop])).not.toContain("<dt>営業時間</dt>");
    expect(shopPage([shop])).not.toContain("<dt>電話</dt>");
  });

  it("主のボタンは Google マップの道順、2 番目は頼み方のページ（#342）", () => {
    const html = shopPage([shop]);
    expect(html).toContain(
      '<a class="seo-primary" href="https://www.google.com/maps/dir/?api=1&amp;destination=35.46%2C139.62" target="_blank" rel="noopener noreferrer">Google マップで道順を見る</a>',
    );
    expect(html).toContain(
      '<a class="seo-secondary" href="/guide/">注文のしかたを見る<small>お好み・卓上・ライス</small></a>',
    );
    expect(html).not.toContain("この店の券売機");
    expect(html).not.toContain("この店をアプリで開く");
  });

  it("近い家系を直線距離の近い順に 3 軒だけ、店名・市区町村・距離で出す（自分は除く）", () => {
    const html = shopPage([
      shop,
      near("node/4", "四番家", 35.5),
      near("node/2", "二番家", 35.47),
      near("node/3", "三番家", 35.48),
      near("node/5", "五番家", 35.6),
    ]);
    const names = [...html.matchAll(/class="seo-near"[^>]*><span><strong>([^<]+)/g)].map(
      (m) => m[1],
    );
    expect(names).toEqual(["二番家", "三番家", "四番家"]);
    expect(html).toContain("この店から近い家系（直線距離）");
    expect(html).toContain("<span>横浜市</span></span><b>1.1km</b>");
  });

  it("報告の 3 つのボタンは、受け口が受け取る種類だけを送る", () => {
    const html = shopPage([shop]);
    expect(html).toContain('data-report-shop="node/123"');
    for (const { kind, label } of REPORT_KINDS) {
      expect(html).toContain(`<button type="button" data-kind="${kind}">${label}</button>`);
      expect(ReportSchema.safeParse({ kind, shopId: "node/123" }).success).toBe(true);
    }
    expect(html).toContain('<div class="seo-report-confirm" hidden>');
    expect(html).not.toContain("すぐ送られます");
    expect(html).toContain('<script src="/shop-report.js" defer></script>');
  });

  it("但し書きは「この情報について」の表にし、中身（推定・参考値・地図の記載・報告の口）を残す", () => {
    const html = shopPage([{ ...shop, openingHours: "10:30-25:00" }]);
    for (const term of ["家系かどうか", "味の分類", "営業時間・電話", "違っていたら"])
      expect(html).toContain(`<dt>${term}</dt>`);
    expect(html).toContain("地図の記載と既知のブランドからの推定");
    expect(html).toContain("既知のブランドからの参考値");
  });

  it("電話番号は +81 を国内の書き方にし、区切りは推し量らない", () => {
    expect(domesticPhone("+81-0564-31-7060")).toBe("0564-31-7060");
    expect(domesticPhone("+81 22 253 6899")).toBe("022-253-6899");
    expect(domesticPhone("+81453929498")).toBe("0453929498");
    expect(domesticPhone("0668501701")).toBe("0668501701");
  });
});

/** 公式の店舗一覧で確かめた記録（verified.json の 1 件）。 */
const chainRecord = (chain: string, source = "chain-list") => ({
  basis: "chain",
  chain,
  status: "open",
  checked: "2026-10-24",
  source,
});

/** 店のページの「この情報について」の「家系かどうか」の値。 */
const about = (html: string) => html.match(/<dt>家系かどうか<\/dt><dd>([^<]*)<\/dd>/)?.[1];

describe("店のページの「家系かどうか」（#316）", () => {
  it("公式の情報で確かめた店は確かめた先と日付を、記録の無い店は推定と書く", () => {
    const { files } = seoPages(
      shops,
      new Map([
        [
          "node/123",
          { basis: "self", status: "open", checked: "2026-10-31", source: "official-sns" },
        ],
      ]),
    );
    expect(about(files.get("/shop/node-123/")!)).toBe("店の公式 SNS で確かめた（2026-10-31）");
    expect(about(files.get("/shop/way-456/")!)).toBe("地図の記載と既知のブランドからの推定");
    const listed = seoPages(shops, new Map([["node/123", chainRecord("試験商店")]])).files;
    expect(about(listed.get("/shop/node-123/")!)).toBe(
      "系列の公式の店舗一覧で確かめた（2026-10-24）",
    );
    const site = seoPages(
      shops,
      new Map([["node/123", chainRecord("試験商店", "official-site")]]),
    ).files;
    expect(about(site.get("/shop/node-123/")!)).toBe("店の公式サイトで確かめた（2026-10-24）");
    // 公式サイトの無い店は、運営会社の発表で確かめる（#356）。公式サイトとは書かない。
    const release = seoPages(
      shops,
      new Map([["node/123", chainRecord("試験商店", "official-release")]]),
    ).files;
    expect(about(release.get("/shop/node-123/")!)).toBe("運営会社の発表で確かめた（2026-10-24）");
    // 誤りの報告の案内と参考値の断りは残す。
    const html = listed.get("/shop/node-123/")!;
    expect(html).toContain("この店の情報、違っていませんか？");
    expect(html).toContain("既知のブランドからの参考値");
  });
});

/** 記録 1 件を持たせた店のページ（#367）。 */
const withUrl = (record: object) =>
  seoPages(shops, new Map([["node/123", record]])).files.get("/shop/node-123/")!;
const official = (html: string) => html.match(/<dt>公式の情報<\/dt><dd>(.*?)<\/dd>/)?.[1];

describe("店のページの確かめた先へのリンク（#367）", () => {
  it("公式で確かめた先へ、出典の種類の言い方で、新しいタブのリンクを出す", () => {
    const cases = [
      ["chain-list", "系列の公式の店舗一覧を開く"],
      ["official-site", "店の公式サイトを開く"],
      ["official-sns", "店の公式 SNS を開く"],
      ["official-release", "運営会社の発表を開く"],
    ];
    for (const [source, label] of cases) {
      const html = withUrl({
        ...chainRecord("試験商店", source),
        url: "https://example.com/a?b=1&c=2",
      });
      expect(official(html)).toBe(
        `<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">${label}</a><small>（別のサイト・新しいタブ）</small>`,
      );
    }
    // 公式の http のままのサイト（魂心家など）も出す。
    expect(
      official(withUrl({ ...chainRecord("魂心家"), url: "http://www.konshinya.com/" })),
    ).toContain('href="http://www.konshinya.com/"');
  });

  it("記録が無い・url が無い・閉店・オーナーの実食・http(s) 以外は、行ごと出さない", () => {
    const none = [
      undefined,
      chainRecord("試験商店"),
      { ...chainRecord("試験商店"), status: "closed", url: "https://example.com/" },
      { basis: "self", status: "open", checked: "2026-10-24", source: "owner-visit" },
      { ...chainRecord("試験商店"), url: "javascript:alert(1)" },
    ];
    for (const record of none) {
      const html = record ? withUrl(record) : shopPage([shop]);
      expect(html).not.toContain("<dt>公式の情報</dt>");
      expect(html).not.toContain("javascript:");
    }
  });

  it("営業時間も電話も無い店では「営業時間・電話」の行を出さない", () => {
    expect(shopPage([shop])).not.toContain("<dt>営業時間・電話</dt>");
    expect(shopPage([{ ...shop, phone: "+81-0564-31-7060" }])).toContain("<dt>営業時間・電話</dt>");
    // 公式の情報があるときは、行く前に確かめる先としてそちらを挙げる。
    const both = seoPages(
      [{ ...shop, openingHours: "10:30-25:00" }, shops[1]],
      new Map([["node/123", { ...chainRecord("試験商店"), url: "https://example.com/" }]]),
    ).files.get("/shop/node-123/")!;
    expect(both).toContain("行く前に上の公式の情報か、店の公式情報で確かめてください");
  });
});

/** 店のページの説明文（meta description）。 */
const description = (html: string) => html.match(/name="description" content="([^"]*)"/)![1];
const describedShop = (s: Shop, record?: object) =>
  description(
    seoPages([s, near("node/9", "隣家", 35.47)], new Map(record ? [[s.id, record]] : [])).files.get(
      "/shop/node-123/",
    )!,
  );

describe("店のページの説明文（#382）", () => {
  it("営業時間・電話・公式のリンクが無い店には、その言葉を書かない", () => {
    const text = describedShop(shop);
    expect(text).toBe(
      "試験家の店舗情報。地域は神奈川県 横浜市 西区岡野。Google マップの道順、近くの家系（直線距離）を載せています。",
    );
    for (const word of ["営業時間", "電話", "公式"]) expect(text).not.toContain(word);
  });

  it("地図に記載がある営業時間・電話だけを、地図の記載として挙げる", () => {
    expect(describedShop({ ...shop, openingHours: "11:00-22:00" })).toContain(
      "。営業時間（地図の記載）、Google マップの道順",
    );
    expect(describedShop({ ...shop, phone: "+81-45-000-0000" })).toContain(
      "。電話番号（地図の記載）、",
    );
    expect(
      describedShop({ ...shop, openingHours: "11:00-22:00", phone: "+81-45-000-0000" }),
    ).toContain("。営業時間・電話番号（地図の記載）、");
  });

  it("公式の情報は、確かめた記録（status: open）のリンクがある店だけに書く", () => {
    const open = { ...chainRecord("試験商店"), url: "https://example.com/" };
    expect(describedShop(shop, open)).toContain("。公式の情報へのリンク、Google マップの道順");
    for (const record of [
      chainRecord("試験商店"),
      { ...open, status: "closed" },
      { ...open, url: "javascript:alert(1)" },
    ])
      expect(describedShop(shop, record)).not.toContain("公式");
  });
});

/** 店のページの「〇〇の店舗一覧」のリンク（#381）。 */
const chainLink = (html: string) =>
  html.match(/<p class="seo-back"><a [^>]*href="\/chain\/[^"]*"[^>]*>[^<]*<\/a><\/p>/)?.[0];
const twoShops = [shop, near("node/9", "隣家", 35.47)];
const head = (html: string) => html.slice(0, html.indexOf("</head>"));
const pageOf = (records: [string, object][], list = twoShops) =>
  seoPages(list, new Map(records)).files.get("/shop/node-123/")!;

describe("店のページから系列のページへのリンク（#381）", () => {
  it("系列のページに載る店は、近い家系の下に系列の店舗一覧へのリンクを持つ", () => {
    const html = pageOf([
      ["node/123", chainRecord("町田商店")],
      ["node/9", chainRecord("町田商店")],
    ]);
    expect(chainLink(html)).toBe(
      '<p class="seo-back"><a class="seo-sub-link" href="/chain/machida-shoten/">町田商店の店舗一覧（2 軒）</a></p>',
    );
    expect(html.indexOf("この店から近い家系")).toBeLessThan(html.indexOf("町田商店の店舗一覧"));
  });

  it("系列のページに載らない店（記録なし・系列でない・系列が 1 軒だけ）には何も足さない", () => {
    const cases: [string, object][][] = [
      [],
      [
        [
          "node/123",
          { basis: "self", status: "open", checked: "2026-10-24", source: "owner-visit" },
        ],
      ],
      [["node/123", chainRecord("町田商店")]],
    ];
    for (const records of cases) expect(pageOf(records)).not.toContain('href="/chain/');
  });

  it("リンクを足しても、店のページのタイトルと説明文は変えない", () => {
    const linked = pageOf([
      ["node/123", chainRecord("町田商店")],
      ["node/9", chainRecord("町田商店")],
    ]);
    const plain = pageOf([["node/123", chainRecord("町田商店")]]);
    expect(head(linked)).toBe(head(plain));
  });
});

describe("系列のページ（#309）", () => {
  const tokyo: Shop = {
    ...shop,
    id: "verified/0123456789abcdef0123",
    prefecture: "東京都",
    city: "町田市",
  };
  const chainOf = new Map([
    ["node/123", chainRecord("町田商店")],
    ["verified/0123456789abcdef0123", chainRecord("町田商店")],
    ["way/456", chainRecord("一軒家")],
  ]);
  const { files, redirects } = seoPages([...shops, tokyo], chainOf);
  const path = "/chain/machida-shoten/";

  it("記録の系列で、2 軒以上の系列だけページを作り、sitemap と都道府県の一覧から辿れる", () => {
    const html = files.get(path)!;
    // 「店舗一覧」を先に出し、出どころと運営元のサイトではないことを書く（#340）。
    expect(html).toContain(
      "<title>町田商店の店舗一覧（2軒）｜都道府県ごとに探せる家系ラーメン</title>",
    );
    expect(html).toContain("<h1>町田商店の<wbr>家系ラーメン<wbr>店舗一覧</h1>");
    expect(html).toContain(
      'content="町田商店の店舗一覧（2軒）を都道府県ごとに探せます。系列や店の公式の情報で確かめた店を載せています（運営元のサイトではありません）。住所・Google マップの道順まで。"',
    );
    expect(html).not.toMatch(
      /<title>[^<]*(候補|判定した結果)|description" content="[^"]*(候補|判定した結果)/,
    );
    // 都道府県の並び順（神奈川県より東京都が先）で見出しを置き、見出しへ飛ぶチップを付ける。
    expect(html.indexOf('id="pref-tokyo"')).toBeLessThan(html.indexOf('id="pref-kanagawa"'));
    expect(html).toContain('href="#pref-kanagawa">神奈川県<span>1 軒</span>');
    expect(html).toContain("系列や店の公式の情報で確かめた店です。");
    expect(files.get("/sitemap.xml")).toContain(`https://iekeiramen.com${path}`);
    expect(files.get("/area/")).toContain(`href="${path}">町田商店<span>2 軒</span>`);
    // 1 軒だけの系列は作らない。系列の記録が無ければ、都道府県の一覧に「系列」の段も出さない。
    expect([...files.keys()].some((key) => key.includes(encodeURIComponent("一軒家")))).toBe(false);
    expect(seoPages(shops).files.get("/area/")).not.toContain('id="chains"');
  });

  it("見出しの下に「近くの〇〇を出す」、長い一覧には区切りごとに戻るリンク（#368）", () => {
    const html = files.get(path)!;
    expect(html).toContain(
      `href="/?${new URLSearchParams({ keyword: "町田商店", view: "three" }).toString().replaceAll("&", "&amp;")}">近くの町田商店を出す</a>`,
    );
    // 2 県だけなら戻るほどの長さが無い。3 県からは各県の最後に、上の都道府県のチップへ戻るリンク。
    expect(html).not.toContain("都道府県の一覧へ戻る");
    const osaka: Shop = { ...shop, id: "node/789", prefecture: "大阪府", city: "大阪市" };
    const three = seoPages(
      [...shops, tokyo, osaka],
      new Map([...chainOf, ["node/789", chainRecord("町田商店")]]),
    ).files.get(path)!;
    expect(three.match(/href="#jump">都道府県の一覧へ戻る</g)).toHaveLength(3);
    expect(three).toContain('<h2 class="seo-section" id="jump">都道府県</h2>');
  });

  it("URL は英字にし、#309 で出した日本語の URL から 301 で送る（#326）", () => {
    expect([...files.keys()].filter((key) => key.startsWith("/chain/"))).toEqual([path]);
    const encoded = encodeURIComponent("町田商店");
    expect(redirects.filter(([from]: string[]) => from.startsWith("/chain/"))).toEqual([
      [`/chain/${encoded}/`, path],
      [`/chain/${encoded}`, path],
    ]);
  });

  it("英字の名前の表に無い系列は、ページを作らずに止める", () => {
    const unknown = new Map([
      ["node/123", chainRecord("試験商店")],
      ["way/456", chainRecord("試験商店")],
    ]);
    expect(() => seoPages(shops, unknown)).toThrow("系列の英字の名前がありません: 試験商店");
  });
});

describe("地域ページの題名と説明文（#306）", () => {
  it("軒数と探し方を先に置き、「候補」「判定した結果」を書かない", () => {
    const { files } = seoPages(shops);
    const meta = (path: string) => {
      const html = files.get(path)!;
      return [
        html.match(/<title>(.*?)<\/title>/)![1],
        html.match(/name="description" content="([^"]*)"/)![1],
      ];
    };
    expect(meta("/area/")).toEqual([
      "家系ラーメン 2軒｜都道府県と地図から探す",
      "家系ラーメン2軒を都道府県から探せます。今いる場所から近い 3 軒を地図で出すこともできます。",
    ]);
    expect(meta("/area/kanagawa/")).toEqual([
      "神奈川県の家系ラーメン 2軒｜地図と市区町村から探す",
      "神奈川県の家系ラーメン2軒を地図と市区町村から探せます。住所・Google マップの道順まで。",
    ]);
    expect(meta("/area/kanagawa/yokohama/")).toEqual([
      "神奈川県 横浜市の家系ラーメン 2軒｜地図と店舗一覧から探す",
      "神奈川県 横浜市の家系ラーメン2軒を地図と店舗一覧から探せます。住所・Google マップの道順まで。",
    ]);
  });

  it("営業時間は、地図の記載がある店を含む地域でだけ説明文に挙げる", () => {
    const { files } = seoPages([{ ...shop, openingHours: "Mo-Su 11:00-22:00" }, shops[1]]);
    expect(files.get("/area/kanagawa/")).toContain("住所・営業時間・Google マップの道順まで。");
  });
});

describe("県・市区町村のページ（#255）", () => {
  it("見出しは「〇〇の家系ラーメン」、札は軒数だけ", () => {
    const html = seoPages(shops).files.get("/area/kanagawa/")!;
    expect(html).toContain(
      '<h1>神奈川県の<wbr>家系ラーメン</h1><span class="seo-count">2 軒</span>',
    );
    expect(html).toContain(
      "地図の記載とブランドから集めた一覧です。違う店を見つけたら、店のページから教えてください。",
    );
    // 主ボタンは地図、3 軒に絞るのは次の操作（#307。説明文の「地図と市区町村から探せます」に合わせる）。
    expect(html).toContain(
      'href="/?prefecture=%E7%A5%9E%E5%A5%88%E5%B7%9D%E7%9C%8C&amp;view=map">神奈川県の地図を開く</a>',
    );
    expect(html).toContain(
      'class="seo-secondary" href="/?prefecture=%E7%A5%9E%E5%A5%88%E5%B7%9D%E7%9C%8C">神奈川県から 3 軒に絞る</a>',
    );
    expect(html).not.toContain("押して、発券");
    const city = seoPages(shops).files.get("/area/kanagawa/yokohama/")!;
    // 市区町村のボタンは県のページと同じ 2 つ（#368）。地図は地名を添え、範囲はサーバーが作る。
    expect(city).toContain(
      `href="/?${new URLSearchParams({ prefecture: "神奈川県", keyword: "横浜市", view: "map" }).toString().replaceAll("&", "&amp;")}">横浜市の地図を開く</a>`,
    );
    expect(city).toContain(">横浜市から 3 軒に絞る</a>");
    expect(city).not.toContain("一覧で見る");
  });
});

describe("県のページの店の一覧を市区町村で区切る（#317）", () => {
  const list = [
    { ...shop, id: "node/1", city: "鎌倉市" },
    { ...shop, id: "node/2", city: "横浜市" },
    { ...shop, id: "node/3", city: "横浜市" },
    { ...shop, id: "node/4", city: "大和市" },
    { ...shop, id: "node/5", city: "大和市" },
    { ...shop, id: "node/6", city: "横浜市" },
  ];
  const html = seoPages(list).files.get("/area/kanagawa/")!;

  it("市区町村の見出しに軒数を添え、軒数の多い順に並べる", () => {
    const heads = [...html.matchAll(/<h3>(.+?)<span>(\d+) 軒<\/span><\/h3>/g)].map(
      (m) => `${m[1]} ${m[2]}`,
    );
    expect(heads).toEqual(["横浜市 3", "大和市 2", "鎌倉市 1"]);
  });

  it("上のチップはページの中の見出しへ、見出しの横から市区町村のページへ行ける", () => {
    expect(html).toContain('<a href="#city-1">横浜市<span>3 軒</span></a>');
    expect(html).toContain('<section class="seo-city" id="city-1">');
    expect(html).toContain('href="/area/kanagawa/yokohama/">横浜市のページ</a>');
  });

  it("但し書きは一覧の下に 1 回だけ", () => {
    expect(html.split('class="seo-caveat"').length - 1).toBe(1);
  });
});

describe("薄いページと 404（#169）", () => {
  it("未判定でない店が 1 軒だけの市区町村は noindex・sitemap 外、2 軒なら載せる", () => {
    const one = seoPages(shops);
    const city = "/area/kanagawa/yokohama/";
    expect(one.files.get(city)).toContain('name="robots" content="noindex"');
    expect(one.files.get("/sitemap.xml")).not.toContain(city);
    // 県のページは今どおり載せ、市区町村へのリンクも残す。
    expect(one.files.get("/area/kanagawa/")).not.toContain("noindex");
    expect(one.files.get("/area/kanagawa/")).toContain(`href="${city}"`);
    const two = seoPages([shop, { ...shop, id: "node/789", name: "二軒目家" }]);
    expect(two.files.get(city)).not.toContain("noindex");
    expect(two.files.get("/sitemap.xml")).toContain(city);
  });

  it("404 ページは noindex で canonical を持たず、sitemap に載らない", () => {
    const { files } = seoPages(shops);
    const html = files.get("/404.html")!;
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).not.toContain('rel="canonical"');
    expect(html).toContain('href="/area/"');
    expect(files.get("/sitemap.xml")).not.toContain("404");
  });
});

describe("Webの検索条件リンク", () => {
  it("市区町村・店名は匿名検索へ、県だけは券売機へ渡す", () => {
    expect(webEntry("?prefecture=神奈川県&keyword=横浜市")).toEqual({
      name: "search-iekei-ramen",
      arguments: { prefecture: "神奈川県", keyword: "横浜市" },
    });
    // 県だけなら、その県の券売機（迷ったら）で開く（#152。都道府県のページの発券キー）。
    expect(webEntry("?prefecture=神奈川県")).toEqual({
      name: "decide-iekei-ramen",
      arguments: { prefecture: "神奈川県" },
    });
    // 県と view=map なら、その県の地図で開く（#307。都道府県のページの「地図を開く」）。
    expect(webEntry("?prefecture=神奈川県&view=map")).toEqual({
      name: "show-iekei-ramen-map",
      arguments: { prefecture: "神奈川県" },
    });
    expect(webEntry("?keyword=吉村家")).toEqual({
      name: "search-iekei-ramen",
      arguments: { keyword: "吉村家" },
    });
  });
  it("市区町村は地図と 3 軒、系列は近くの 3 軒で開ける（#368）", () => {
    expect(webEntry("?prefecture=神奈川県&keyword=横浜市&view=map")).toEqual({
      name: "show-iekei-ramen-map",
      arguments: { prefecture: "神奈川県", keyword: "横浜市" },
    });
    expect(webEntry("?prefecture=神奈川県&keyword=横浜市&view=three")).toEqual({
      name: "decide-iekei-ramen",
      arguments: { prefecture: "神奈川県", keyword: "横浜市" },
    });
    expect(webEntry("?keyword=町田商店&view=three")).toEqual({
      name: "decide-iekei-ramen",
      arguments: { keyword: "町田商店", near: "auto" },
    });
    // 座標は URL から受け取らない（view を付けても同じ）。
    expect(webEntry("?view=map&lat=35.46&lon=139.62")).toEqual({
      name: "decide-iekei-ramen",
      arguments: { near: "auto" },
    });
  });
  it("共有の URL（three）は掲載の店の ID の形で 1〜3 つだけ受け取る（#344）", () => {
    expect(webEntry("?three=node-1,way-2,manual-0123456789abcdef0123")).toEqual({
      name: "decide-iekei-ramen",
      arguments: { shared: ["node/1", "way/2", "manual/0123456789abcdef0123"] },
    });
    const home = { name: "decide-iekei-ramen", arguments: { near: "auto" } };
    for (const query of [
      "?three=node-1,node-2,node-3,node-4", // 4 つ以上
      "?three=node-1,node-1", // 重なり
      "?three=35.46,139.62", // 座標は店の ID の形にならない
      "?three=node-1,search-iekei-ramen",
      "?three=",
      "?three=node-1&prefecture=神奈川県&lat=35.46", // 共有の URL は ID 以外を見ない
    ])
      expect(webEntry(query), query).toEqual(
        query.startsWith("?three=node-1&")
          ? { name: "decide-iekei-ramen", arguments: { shared: ["node/1"] } }
          : home,
      );
  });
  it("URL無し・不正な県・長すぎるキーワードは券売機（迷ったら）で開く", () => {
    for (const query of [
      "",
      "?prefecture=神奈川",
      `?keyword=${"x".repeat(101)}`,
      "?tool=stamp-iekei-ramen",
    ])
      expect(webEntry(query)).toEqual({ name: "decide-iekei-ramen", arguments: { near: "auto" } });
  });
});

describe("検索結果と共有のための追加（#155）", () => {
  it("店が全部未判定の県・市区町村ページは noindex にし、sitemap から外す", () => {
    const only = { ...shop, id: "way/9", name: "未判定だけ家", confidence: "candidate" as const };
    const { files, counts } = seoPages([only]);
    expect(files.get("/area/kanagawa/")).toContain('name="robots" content="noindex"');
    expect(files.get("/area/kanagawa/yokohama/")).toContain('name="robots" content="noindex"');
    expect(files.get("/sitemap.xml")).not.toContain("/area/kanagawa/");
    expect(counts.indexed).toBe(7);
    // 1 軒でも未判定以外があれば今どおり index する。
    expect(seoPages(shops).files.get("/area/kanagawa/")).not.toContain("noindex");
  });

  it("市区町村と店のページに、見えているリンクと同じ階層のパンくずを付ける", () => {
    const { files } = seoPages(shops);
    const crumbs = (path: string) =>
      (
        jsonLd(files.get(path)!).find((item) => item["@type"] === "BreadcrumbList")!
          .itemListElement as { position: number; name: string; item: string }[]
      ).map(({ position, name, item }) => [position, name, item]);
    expect(crumbs("/shop/node-123/")).toEqual([
      [1, "神奈川県", "https://iekeiramen.com/area/kanagawa/"],
      [2, "横浜市", "https://iekeiramen.com/area/kanagawa/yokohama/"],
      [3, "試験家", "https://iekeiramen.com/shop/node-123/"],
    ]);
    expect(crumbs("/area/kanagawa/yokohama/")).toEqual([
      [1, "神奈川県", "https://iekeiramen.com/area/kanagawa/"],
      [2, "横浜市", "https://iekeiramen.com/area/kanagawa/yokohama/"],
    ]);
  });

  it("生成するページに、title・description と同じ内容の OGP と twitter のタグを付ける", () => {
    for (const [path, html] of seoPages(shops).files) {
      if (!path.endsWith("/")) continue;
      const title = html.match(/<title>(.*?)<\/title>/)![1];
      expect(html).toContain(`<meta property="og:title" content="${title}">`);
      expect(html).toContain(`<meta property="og:url" content="https://iekeiramen.com${path}">`);
      expect(html).toContain(
        '<meta property="og:image" content="https://iekeiramen.com/og-card.png">',
      );
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    }
  });

  it("トップに WebSite の JSON-LD、/connect に OGP がある", () => {
    const top = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(jsonLd(top)).toContainEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "家系ラーメンを探す",
      url: "https://iekeiramen.com/",
    });
    const connect = readFileSync(new URL("../public/connect.html", import.meta.url), "utf8");
    expect(connect).toContain('property="og:url" content="https://iekeiramen.com/connect"');
    expect(connect).toContain('property="og:image" content="https://iekeiramen.com/og-card.png"');
    expect(connect).toContain('name="twitter:card" content="summary_large_image"');
  });

  it("sitemap に入れる機能のページ（マッチ・カメラ・診断）は noindex を持たない", () => {
    for (const page of ["match", "camera", "shindan"]) {
      const html = readFileSync(new URL(`../${page}/index.html`, import.meta.url), "utf8");
      expect(html, page).not.toMatch(/name="robots"[^>]*noindex/);
      expect(html, page).toContain(
        `<link rel="canonical" href="https://iekeiramen.com/${page}/" />`,
      );
    }
  });
});

describe("頼み方のページ（/guide/、#342）", () => {
  const { files } = seoPages(shops);
  const html = files.get("/guide/")!;

  it("題名に「家系ラーメンの頼み方」が入り、sitemap に載る", () => {
    expect(html).toContain("<title>家系ラーメンの頼み方｜");
    expect(files.get("/sitemap.xml")).toContain("<loc>https://iekeiramen.com/guide/</loc>");
  });

  it("中身はアプリの注文のしかたと同じ源から作る（片方だけ直すとここで落ちる）", () => {
    for (const { label, options, note } of PREFERENCES) {
      expect(html).toContain(
        `<dt>${label}</dt><dd><b>${options.join(" / ")}</b><span>${note}</span>`,
      );
    }
    for (const { label, choice, why } of ORDER_SETS) {
      expect(html).toContain(
        `<dt>${label}</dt><dd><b>${choice.join(" / ")}</b><span>${why}</span>`,
      );
    }
    for (const tip of SIDE_TIPS) expect(html).toContain(`<li>${tip}</li>`);
    // 店ごとの決まりではない、の但し書きを残す。
    expect(html).toContain(ORDER_DISCLAIMER);
  });

  it("下から近くの 3 軒へつなぎ、県のページからも来られる", () => {
    expect(html).toContain('<a class="seo-primary" href="/">近くの 3 軒を出す</a>');
    expect(files.get("/area/kanagawa/")).toContain('href="/guide/"');
  });
});

describe("市区町村のページの URL（#341）", () => {
  const real: Shop[] = JSON.parse(
    readFileSync(new URL("../data/shops.json", import.meta.url), "utf8"),
  );
  const { files, redirects } = seoPages(real);
  const cities = [...new Set(real.filter((s) => s.city).map((s) => `${s.prefecture}\t${s.city}`))];
  const cityPages = [...files.keys()].filter((key) => /^\/area\/[a-z]+\/[^/]+\/$/.test(key));

  it("すべての市区町村のページが英字の URL で、sitemap に % が出ない", () => {
    expect(cityPages).toHaveLength(cities.length);
    for (const key of cityPages) expect(key).toMatch(/^\/area\/[a-z]+\/[a-z]+(?:-[a-z]+)?\/$/);
    expect(files.get("/sitemap.xml")).not.toMatch(/\/area\/[a-z]+\/[^<]*%/);
    expect(files.get("/area/aichi/nagoya/")).toContain("<title>愛知県 名古屋市の家系ラーメン");
  });

  it("日本語の URL（末尾の / あり・なし）は、すべて英字の URL へ送る", () => {
    const to = new Map(redirects);
    for (const pair of cities) {
      const [prefecture, city] = pair.split("\t");
      // 県のページの英字（/area/<県>/）は、その県の店のページのパンくずから取る。
      const firstShop = files.get(
        `/shop/${real.find((s) => s.prefecture === prefecture)!.id.replace("/", "-")}/`,
      )!;
      const pref = /href="\/area\/([a-z]+)\/"/.exec(firstShop)![1];
      for (const end of ["/", ""]) {
        const target = to.get(`/area/${pref}/${encodeURIComponent(city)}${end}`);
        expect(target, `${prefecture}${city}${end}`).toMatch(/^\/area\/[a-z]+\/[a-z-]+\/$/);
        expect(files.get(target!)).toContain(`<title>${prefecture} ${city}の家系ラーメン`);
      }
    }
    expect(to.get("/area/aichi/%E5%90%8D%E5%8F%A4%E5%B1%8B%E5%B8%82/")).toBe("/area/aichi/nagoya/");
  });

  it("英字の名前が無い市区町村は、ページを作らずに止める", () => {
    expect(() => seoPages([{ ...shop, city: "架空市" }])).toThrow(
      "市区町村の英字の名前がありません: 神奈川県架空市",
    );
  });
});

/** タグを「|」にした本文（#345 のページの文の並びを見る）。 */
const text = (html: string) => html.replace(/<[^>]+>/g, "|");
/** 月の見出しから次の月の見出しまで。 */
const section = (html: string, heading: string) =>
  text(
    html
      .split(`<h2 class="seo-section">${heading}</h2>`)[1]
      ?.split('<h2 class="seo-section">')[0] ?? "",
  );

describe("公式で確かめた開店・閉店のページ（#345）", () => {
  const opened = {
    name: "試験家 新店",
    prefecture: "東京都",
    address: "千代田区1-1",
    basis: "chain",
    chain: "町田商店",
    status: "open",
    opened: "2026-11-02",
    checked: "2026-11-04",
    source: "chain-list",
  };
  const found = { ...opened, name: "試験家 日付なし", address: "千代田区2-2", opened: true };
  const lastMonth = {
    ...opened,
    name: "試験家 先月",
    address: "千代田区3-3",
    opened: "2026-10-26",
  };
  const closed = { ...opened, name: "試験家 閉店", address: "千代田区4-4", status: "closed" };
  const visit = { ...closed, name: "試験家 実食", address: "千代田区5-5", source: "owner-visit" };
  const plain = { ...opened, name: "試験家 確かめただけ", address: "千代田区6-6" };
  delete (plain as { opened?: unknown }).opened;
  const today = new Date("2026-11-05T00:00:00Z");

  it("記録から月ごとに作り、「開いた店」は公式の開店日がその月の店だけ", () => {
    const html = seoPages(
      shops,
      new Map(),
      [opened, found, lastMonth, closed, visit, plain],
      today,
    ).files.get("/new/")!;
    const now = section(html, "2026年11月（今月）");
    expect(now).toContain("|開いた店|1 軒|");
    expect(now).toContain("試験家 新店");
    expect(now).toContain(
      "11月2日に開店（公式に書いてある開店日）。系列の公式の店舗一覧で確かめた（2026-11-04）",
    );
    // 開店日の無い店は「開いた店」に入れず、確かめた日を出す。
    expect(now.split("|開店を確かめた店|1 軒|")[1]).toContain("試験家 日付なし");
    expect(now.split("|開店を確かめた店|1 軒|")[0]).not.toContain("試験家 日付なし");
    expect(now).toContain(
      "開店を系列の公式の店舗一覧で確かめた（2026-11-04）。開店日は公式に書いてありません",
    );
    // 先月開いた店は、確かめたのが今月でも先月に置く（「今月開いた」と読ませない）。
    expect(now).not.toContain("試験家 先月");
    expect(section(html, "2026年10月")).toContain("10月26日に開店");
    // 閉店は確かめた月に。オーナーの実食のような公開しない先は書かない。
    expect(now.split("|閉店を確かめた店|2 軒|")[1]).toContain(
      "閉店を系列の公式の店舗一覧で確かめた（2026-11-04）",
    );
    expect(now).toContain("試験家 実食");
    expect(now).toContain("閉店を確かめた（2026-11-04）");
    expect(html).not.toContain("実食で");
    // 開店も閉店も示していない記録は載せない。
    expect(html).not.toContain("試験家 確かめただけ");
  });

  it("今のデータにある店は店のページへつなぎ、sitemap・都道府県の一覧から行ける", () => {
    const linked = {
      id: "node/123",
      basis: "chain",
      chain: "町田商店",
      status: "open",
      opened: true,
      checked: "2026-11-04",
      source: "chain-list",
    };
    const { files } = seoPages(shops, new Map(), [linked], today);
    expect(files.get("/new/")).toContain('<a href="/shop/node-123/">');
    expect(files.get("/sitemap.xml")).toContain("https://iekeiramen.com/new/");
    expect(files.get("/area/")).toContain('href="/new/"');
    expect(seoPages(shops, new Map(), [], today).files.get("/new/")).toContain("まだありません。");
  });

  it("/new/ は今月を含む直近 3 か月だけ。それより前の月は /new/YYYY-MM/ に移し、新しい順にリンクする（#358）", () => {
    const august = { ...opened, name: "試験家 8月", address: "千代田区7-7", opened: "2026-08-03" };
    const records = [opened, lastMonth, august];
    // 12/31 は 10・11・12 月が直近 3 か月。まだ移さない。
    const dec = seoPages(shops, new Map(), records, new Date("2026-12-31T12:00:00Z")).files;
    expect(dec.get("/new/")).toContain('<h2 class="seo-section">2026年10月</h2>');
    expect(dec.has("/new/2026-10/")).toBe(false);
    expect(dec.has("/new/2026-08/")).toBe(true);
    // 1 月になると 10 月が外れる（11・12・1 月）。
    const { files } = seoPages(shops, new Map(), records, new Date("2027-01-10T00:00:00Z"));
    const top = files.get("/new/")!;
    expect(top).toContain('<h2 class="seo-section">2026年11月</h2>');
    expect(top).not.toContain("試験家 先月");
    expect(top).not.toContain("試験家 8月");
    const archive = top.split('<h2 class="seo-section">それより前の月</h2>')[1]!;
    expect(archive.indexOf('href="/new/2026-10/"')).toBeLessThan(
      archive.indexOf('href="/new/2026-08/"'),
    );
    expect(archive).toContain('<a href="/new/2026-10/">2026年10月<span>1 軒</span></a>');
    const october = files.get("/new/2026-10/")!;
    expect(october).toContain("<title>家系ラーメンの開店・閉店（2026年10月）｜");
    expect(section(october, "2026年10月")).toContain("試験家 先月");
    expect(october).not.toContain("試験家 新店");
    expect(october).toContain('<a href="/new/">開店・閉店</a>');
    expect(october).toContain("既知のブランドからの参考値");
    const sitemap = files.get("/sitemap.xml")!;
    expect(sitemap).toContain("https://iekeiramen.com/new/2026-10/");
    expect(sitemap).toContain("https://iekeiramen.com/new/2026-08/");
    // 直近 3 か月に記録が無くても、過ぎた月へは行ける。
    const later = seoPages(shops, new Map(), records, new Date("2027-06-01T00:00:00Z")).files;
    expect(later.get("/new/")).toContain("まだありません。");
    expect(later.get("/new/")).toContain('href="/new/2026-11/"');
  });

  it("実データ: 10 月に開いた 2 店が、確かめた日と出どころつきで出る", () => {
    const real = JSON.parse(
      readFileSync(new URL("../data/verified.json", import.meta.url), "utf8"),
    );
    const html = seoPages(shops, new Map(), real, today).files.get("/new/")!;
    const october = section(html, "2026年10月");
    expect(october).toContain("横浜家系ラーメン 町田商店 松原店");
    expect(october).toContain("壱角家 御茶ノ水店");
    expect(october).toContain(
      "10月26日に開店（公式に書いてある開店日）。系列の公式の店舗一覧で確かめた（2026-11-04）",
    );
  });
});
