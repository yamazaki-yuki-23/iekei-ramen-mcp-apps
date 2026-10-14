import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { legalPages, seoPages, siteHeader } from "./seo-pages.mjs";
import { legalLinksHtml } from "../src/lib/legal-links.ts";
import { tabBarHtml } from "../src/lib/tabbar.ts";
import { TYPES, shareUrl } from "../src/shindan/shindan.ts";

const output = new URL("../dist/web/", import.meta.url);
const shops = JSON.parse(await readFile(new URL("../data/shops.json", import.meta.url), "utf8"));
const { files, counts } = seoPages(shops);
const legal = legalPages({
  privacy: await readFile(new URL("../docs/legal/privacy-policy.md", import.meta.url), "utf8"),
  terms: await readFile(new URL("../docs/legal/terms.md", import.meta.url), "utf8"),
});
for (const [path, content] of [...files, ...legal]) {
  const destination = new URL(`.${path}${path.endsWith("/") ? "index.html" : ""}`, output);
  await mkdir(new URL(".", destination), { recursive: true });
  await writeFile(destination, content);
}
await copyFile(new URL("../src/global.css", import.meta.url), new URL("seo-tokens.css", output));

/*
 * 「チャットで使う方法」（/connect、#196）も、ほかの静的なページと同じヘッダーと下のタブバーにする。
 * public/connect.html は手で書いた 1 枚なので、ビルドの後でヘッダーを差し替え、タブバーを足す。
 * /connect はどのタブにも属さないので、選ばれたタブは無し。
 */
const connectFile = new URL("connect.html", output);
const connect = await readFile(connectFile, "utf8");
const connectHeader = /<header>[\s\S]*?<\/header>/;
if (!connectHeader.test(connect) || !connect.includes("</body>") || !connect.includes("</footer>"))
  throw new Error("connect.html のヘッダー・フッター・タブバーの置き場所が見つかりません");
await writeFile(
  connectFile,
  connect
    .replace(connectHeader, siteHeader("/connect"))
    // 規約へのリンク（#198）。接続して使い始める前に目に入るように、フッターに置く。
    .replace("</footer>", `${legalLinksHtml()}</footer>`)
    .replace("</body>", `${tabBarHtml()}</body>`),
);

/*
 * 家系タイプ診断のシェア用の紙（#167）。中身は診断と同じページで、開くと 1 問目から始まる。
 * OGP の題と画像だけをタイプごとに差し替える（SNS のカードにタイプの画像が出る）。
 */
const shindan = await readFile(new URL("shindan/index.html", output), "utf8");
for (const type of Object.values(TYPES)) {
  const title = `家系タイプ診断｜結果は「${type.name}」`;
  const html = shindan
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(property="og:title"\s+content=")[^"]*/, `$1${title}`)
    .replace(/(property="og:url"\s+content=")[^"]*/, `$1${shareUrl(type.key)}`)
    .replace(
      /(property="og:image"\s+content=")[^"]*/,
      `$1https://iekeiramen.com/og/shindan-${type.key}.png`,
    )
    .replace(
      /(name="twitter:image"\s+content=")[^"]*/,
      `$1https://iekeiramen.com/og/shindan-${type.key}.png`,
    );
  if (!html.includes(`og/shindan-${type.key}.png`))
    throw new Error(`OGP を差し替えられませんでした: ${type.key}`);
  const destination = new URL(`shindan/${type.key}/index.html`, output);
  await mkdir(new URL(".", destination), { recursive: true });
  await writeFile(destination, html);
}
console.log(
  `SEO: 都道府県${counts.prefectures} / 市区町村${counts.municipalities} / 店舗${counts.shops} / sitemap ${counts.indexed} URL`,
);
