import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { legalMarkdown } from "../scripts/legal-markdown.mjs";
import { legalPages, seoPages } from "../scripts/seo-pages.mjs";

const read = (name: string) =>
  readFileSync(new URL(`../docs/legal/${name}.md`, import.meta.url), "utf8");
const privacy = read("privacy-policy");
const terms = read("terms");

describe("規約の Markdown（#198）", () => {
  it("見出し・表・入れ子の番号付きリスト・太字・リンクを HTML にし、コメントは出さない", () => {
    const { title, html } = legalMarkdown(`<!-- 内部のメモ -->

# 題

本文の
続き **太字** と \`code\`。

## 1. 表

| 項目 | 中身 |
| --- | --- |
| a | [規約](terms.md) |

1. 一つめ
   1. 入れ子
2. 二つめ`);
    expect(title).toBe("題");
    expect(html).not.toContain("内部のメモ");
    expect(html).toContain("<p>本文の続き <strong>太字</strong> と <code>code</code>。</p>");
    expect(html).toContain('<th scope="col">項目</th>');
    expect(html).toContain('<td><a href="/terms">規約</a></td>');
    expect(html).toContain("<ol><li>一つめ<ol><li>入れ子</li></ol></li><li>二つめ</li></ol>");
  });

  it("文中の < や & はそのまま文字として出す", () => {
    expect(legalMarkdown("a < b & c").html).toBe("<p>a &lt; b &amp; c</p>");
  });
});

describe("/privacy・/terms のページ（#198）", () => {
  const files = legalPages({ privacy, terms });

  it("2 つのページを作り、【】を残さない。裁判所は東京地方裁判所", () => {
    expect([...files.keys()]).toEqual(["/privacy.html", "/terms.html"]);
    for (const html of files.values()) expect(html).not.toContain("【");
    expect(files.get("/terms.html")).toContain("東京地方裁判所");
    expect(files.get("/privacy.html")).toContain(
      '<link rel="canonical" href="https://iekeiramen.com/privacy">',
    );
    expect(files.get("/privacy.html")).toContain("<h1>プライバシーポリシー</h1>");
  });

  it("規約から規約へのリンクは、公開している URL を指す", () => {
    expect(files.get("/terms.html")).toContain('<a href="/privacy">プライバシーポリシー</a>');
    expect(files.get("/terms.html")).not.toContain("privacy-policy.md");
  });

  it("【】が残っていればビルドを止める", () => {
    expect(() => legalPages({ privacy: "# 題\n\n制定日: 【公開日】", terms })).toThrow(/【】/);
  });

  it("今の機能の扱いを書いている（端末の中だけ・外部への送信・計測）", () => {
    for (const phrase of [
      "localStorage",
      "家系タイプ診断の回答は、送らず保存しません",
      "家系カメラの写真は、利用者の端末の中だけで加工します",
      "Cloudflare Web Analytics",
      "Nominatim",
      "openid",
      "IP アドレスは保存しません",
    ])
      expect(privacy).toContain(phrase);
  });
});

describe("規約へのリンク（#198）", () => {
  it("都道府県・店・404 のページのフッターから 2 つのページへリンクする", () => {
    const { files } = seoPages(
      JSON.parse(readFileSync(new URL("../data/shops.json", import.meta.url), "utf8")),
    );
    for (const path of ["/area/", "/area/kanagawa/", "/404.html"]) {
      const footer = files.get(path)!.match(/<footer>[\s\S]*?<\/footer>/)![0];
      expect(footer).toContain('<a href="/privacy">プライバシーポリシー</a>');
      expect(footer).toContain('<a href="/terms">利用規約</a>');
    }
  });
});
