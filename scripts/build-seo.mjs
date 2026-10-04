import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { seoPages } from "./seo-pages.mjs";

const output = new URL("../dist/web/", import.meta.url);
const shops = JSON.parse(await readFile(new URL("../data/shops.json", import.meta.url), "utf8"));
const { files, counts } = seoPages(shops);
for (const [path, content] of files) {
  const destination = new URL(`.${path}${path.endsWith("/") ? "index.html" : ""}`, output);
  await mkdir(new URL(".", destination), { recursive: true });
  await writeFile(destination, content);
}
await copyFile(new URL("../src/global.css", import.meta.url), new URL("seo-tokens.css", output));
console.log(
  `SEO: 都道府県${counts.prefectures} / 市区町村${counts.municipalities} / 店舗${counts.shops} / sitemap ${counts.indexed} URL`,
);
