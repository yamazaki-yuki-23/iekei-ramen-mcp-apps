import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seoPages } from "../scripts/seo-pages.mjs";
import { CONFIDENCE, type Shop } from "../src/lib/types";
import { webEntry } from "../src/lib/web-entry";

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

describe("静的SEOページ", () => {
  it("県・市・店を生成し、未判定だけnoindexとsitemap除外にする", () => {
    const { files, counts } = seoPages(shops);
    expect(counts).toEqual({ prefectures: 1, municipalities: 1, shops: 2, indexed: 5 });
    expect(files.get("/area/kanagawa/")).toContain("判定した結果の2軒");
    expect(files.get("/area/kanagawa/%E6%A8%AA%E6%B5%9C%E5%B8%82/")).toContain("未判定家");
    expect(files.get("/shop/node-123/")).not.toContain('name="robots" content="noindex"');
    expect(files.get("/shop/way-456/")).toContain('name="robots" content="noindex"');
    expect(files.get("/sitemap.xml")).toContain("https://iekeiramen.com/shop/node-123/");
    expect(files.get("/sitemap.xml")).not.toContain("way-456");
    expect(files.get("/robots.txt")).toContain("Sitemap: https://iekeiramen.com/sitemap.xml");
  });
  it("地域の一覧は、判定の段階を形と見える説明文の両方で出す", () => {
    const html = seoPages(shops).files.get("/area/kanagawa/")!;
    // title だけに置くと、タッチ端末や読み上げで説明が届かない。
    expect(html).toContain(`<p class="seo-note">${CONFIDENCE.candidate.description}</p>`);
    expect(html).toContain('<span aria-hidden="true">？</span>家系か未判定');
    expect(html).toContain('<span aria-hidden="true">■</span>家系');
  });
  it("未信頼の文字列をHTMLとJSON-LDの両方で安全に扱い、評価や営業時間を付けない", () => {
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
    const structured = JSON.parse(
      html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1],
    );
    expect(structured).toEqual({
      "@context": "https://schema.org",
      "@type": "Restaurant",
      name: hostile.name,
      address: {
        "@type": "PostalAddress",
        addressRegion: "神奈川県",
        addressLocality: "横浜市",
        streetAddress: "西区岡野",
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
      expect(html).toContain("家系判定と味の傾向");
      expect(html).toContain("OpenStreetMap contributors");
      expect(html).toContain("ODbL");
      expect(html).toContain('rel="icon"');
    }
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    expect(new Set(canonicals).size).toBe(canonicals.length);
    expect(counts.shops).toBe(data.length);
    expect(counts.indexed).toBe(
      2 +
        counts.prefectures +
        counts.municipalities +
        data.filter((s) => s.confidence !== "candidate").length,
    );
  });
});

describe("Webの検索条件リンク", () => {
  it("県・市区町村・店名を既存の匿名検索へ渡す", () => {
    expect(webEntry("?prefecture=神奈川県&keyword=横浜市")).toEqual({
      name: "search-iekei-ramen",
      arguments: { prefecture: "神奈川県", keyword: "横浜市" },
    });
    expect(webEntry("?prefecture=神奈川県")).toEqual({
      name: "search-iekei-ramen",
      arguments: { prefecture: "神奈川県" },
    });
    expect(webEntry("?keyword=吉村家")).toEqual({
      name: "search-iekei-ramen",
      arguments: { keyword: "吉村家" },
    });
  });
  it("URL無し・不正な県・長すぎるキーワードは地図で開く", () => {
    for (const query of [
      "",
      "?prefecture=神奈川",
      `?keyword=${"x".repeat(101)}`,
      "?tool=stamp-iekei-ramen",
    ])
      expect(webEntry(query)).toEqual({ name: "show-iekei-ramen-map", arguments: {} });
  });
});
