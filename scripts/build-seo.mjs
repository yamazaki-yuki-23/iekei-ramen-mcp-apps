import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { seoPages } from "./seo-pages.mjs";
import { TYPES, shareUrl } from "../src/lib/shindan.ts";

const output = new URL("../dist/web/", import.meta.url);
const shops = JSON.parse(await readFile(new URL("../data/shops.json", import.meta.url), "utf8"));
const { files, counts } = seoPages(shops);
for (const [path, content] of files) {
  const destination = new URL(`.${path}${path.endsWith("/") ? "index.html" : ""}`, output);
  await mkdir(new URL(".", destination), { recursive: true });
  await writeFile(destination, content);
}
await copyFile(new URL("../src/global.css", import.meta.url), new URL("seo-tokens.css", output));

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
