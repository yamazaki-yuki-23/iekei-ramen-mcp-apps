import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { domesticPhone, REPORT_KINDS, seoPages } from "../scripts/build/seo-pages.mjs";
import { ReportSchema } from "../src/lib/reports";
import { type Shop } from "../src/types";
import { CONFIDENCE } from "../src/utils/labels";
import { webEntry } from "../src/features/search/utils/web-entry";

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
    expect(counts).toEqual({ prefectures: 1, municipalities: 1, shops: 2, indexed: 7 });
    // 固定の 5 枚（トップ・家系マッチ #181・家系カメラ #242・家系タイプ診断 #167・都道府県の一覧）も載せる。
    expect(files.get("/sitemap.xml")).toContain("https://iekeiramen.com/match/");
    // 家系カメラも検索に載せる（#242）。見本の段階は終わった。
    expect(files.get("/sitemap.xml")).toContain("https://iekeiramen.com/camera/");
    expect(files.get("/area/kanagawa/")).toContain("神奈川県の家系ラーメン2軒");
    expect(files.get("/area/kanagawa/%E6%A8%AA%E6%B5%9C%E5%B8%82/")).toContain("未判定家");
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
      expect(path === "/area/" || path.startsWith("/area/") || path.startsWith("/shop/")).toBe(
        true,
      );
      titles.push(html.match(/<title>(.*?)<\/title>/)![1]);
      descriptions.push(html.match(/name="description" content="([^"]*)"/)![1]);
      canonicals.push(html.match(/rel="canonical" href="([^"]*)"/)![1]);
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
      5 +
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

  it("主のボタンは Google マップの道順、2 番目は注文のしかた（券売機の見出しは出さない）", () => {
    const html = shopPage([shop]);
    expect(html).toContain(
      '<a class="seo-primary" href="https://www.google.com/maps/dir/?api=1&amp;destination=35.46%2C139.62" target="_blank" rel="noopener noreferrer">Google マップで道順を見る</a>',
    );
    expect(html).toContain("注文のしかたを見る<small>まわる店にも追加できます</small>");
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
    expect(html).toContain('<script src="/shop-report.js" defer></script>');
  });

  it("但し書きは「この情報について」の表にし、中身（推定・参考値・地図の記載・報告の口）を残す", () => {
    const html = shopPage([shop]);
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
    // 記録の url は画面に出さない。誤りの報告の案内と参考値の断りは残す。
    const html = listed.get("/shop/node-123/")!;
    expect(html).not.toContain("https://example");
    expect(html).toContain("この店の情報、違っていませんか？");
    expect(html).toContain("既知のブランドからの参考値");
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
    ["node/123", chainRecord("試験商店")],
    ["verified/0123456789abcdef0123", chainRecord("試験商店")],
    ["way/456", chainRecord("一軒家")],
  ]);
  const { files } = seoPages([...shops, tokyo], chainOf);
  const path = `/chain/${encodeURIComponent("試験商店")}/`;

  it("記録の系列で、2 軒以上の系列だけページを作り、sitemap と都道府県の一覧から辿れる", () => {
    const html = files.get(path)!;
    expect(html).toContain("<title>試験商店の家系ラーメン 2軒｜都道府県ごとの店舗一覧</title>");
    expect(html).toContain(
      'content="試験商店の家系ラーメン2軒を都道府県ごとの一覧から探せます。住所・Google マップの道順まで。"',
    );
    expect(html).not.toMatch(
      /<title>[^<]*(候補|判定した結果)|description" content="[^"]*(候補|判定した結果)/,
    );
    // 都道府県の並び順（神奈川県より東京都が先）で見出しを置き、見出しへ飛ぶチップを付ける。
    expect(html.indexOf('id="pref-tokyo"')).toBeLessThan(html.indexOf('id="pref-kanagawa"'));
    expect(html).toContain('href="#pref-kanagawa">神奈川県<span>1 軒</span>');
    expect(html).toContain("系列の公式の店舗一覧で確かめた店です。");
    expect(files.get("/sitemap.xml")).toContain(`https://iekeiramen.com${path}`);
    expect(files.get("/area/")).toContain(`href="${path}">試験商店<span>2 軒</span>`);
    // 1 軒だけの系列は作らない。系列の記録が無ければ、都道府県の一覧に「系列」の段も出さない。
    expect([...files.keys()].some((key) => key.includes(encodeURIComponent("一軒家")))).toBe(false);
    expect(seoPages(shops).files.get("/area/")).not.toContain('id="chains"');
  });

  it("系列名にパスの区切りがあれば止める", () => {
    expect(() => seoPages(shops, new Map([["node/123", chainRecord("a/b")]]))).toThrow("系列名");
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
    expect(meta("/area/kanagawa/%E6%A8%AA%E6%B5%9C%E5%B8%82/")).toEqual([
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
    const city = seoPages(shops).files.get("/area/kanagawa/%E6%A8%AA%E6%B5%9C%E5%B8%82/")!;
    expect(city).toContain(">横浜市の店を一覧で見る</a>");
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
    expect(html).toContain('href="/area/kanagawa/%E6%A8%AA%E6%B5%9C%E5%B8%82/">横浜市のページ</a>');
  });

  it("但し書きは一覧の下に 1 回だけ", () => {
    expect(html.split('class="seo-caveat"').length - 1).toBe(1);
  });
});

describe("薄いページと 404（#169）", () => {
  it("未判定でない店が 1 軒だけの市区町村は noindex・sitemap 外、2 軒なら載せる", () => {
    const one = seoPages(shops);
    const city = "/area/kanagawa/%E6%A8%AA%E6%B5%9C%E5%B8%82/";
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
    expect(files.get("/area/kanagawa/%E6%A8%AA%E6%B5%9C%E5%B8%82/")).toContain(
      'name="robots" content="noindex"',
    );
    expect(files.get("/sitemap.xml")).not.toContain("/area/kanagawa/");
    expect(counts.indexed).toBe(5);
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
      [2, "横浜市", "https://iekeiramen.com/area/kanagawa/%E6%A8%AA%E6%B5%9C%E5%B8%82/"],
      [3, "試験家", "https://iekeiramen.com/shop/node-123/"],
    ]);
    expect(crumbs("/area/kanagawa/%E6%A8%AA%E6%B5%9C%E5%B8%82/")).toEqual([
      [1, "神奈川県", "https://iekeiramen.com/area/kanagawa/"],
      [2, "横浜市", "https://iekeiramen.com/area/kanagawa/%E6%A8%AA%E6%B5%9C%E5%B8%82/"],
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
