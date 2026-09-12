/**
 * data/osm-raw.json を絞り込み・正規化して data/shops.json を生成する。
 * 判定ロジック本体は classify.mjs にある。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { toShop } from "./classify.mjs";

const DIR = path.join(import.meta.dirname, "..", "data");
const raw = JSON.parse(await fs.readFile(path.join(DIR, "osm-raw.json"), "utf-8"));

const seen = new Set();
const shops = [];

for (const el of raw) {
  const shop = toShop(el);
  if (!shop) continue;

  // 同一店舗の重複（node と way の両方に存在する等）を名前＋座標で除去
  const key = `${shop.name}@${shop.lat.toFixed(4)},${shop.lon.toFixed(4)}`;
  if (seen.has(key)) continue;
  seen.add(key);

  shops.push(shop);
}

// 家系確定の店を先に、その中は都道府県・店名順。
const sorted = shops.toSorted(
  (a, b) =>
    (a.confidence === b.confidence ? 0 : a.confidence === "confirmed" ? -1 : 1) ||
    a.prefecture.localeCompare(b.prefecture, "ja") ||
    a.name.localeCompare(b.name, "ja"),
);

await fs.writeFile(path.join(DIR, "shops.json"), JSON.stringify(sorted));

const byPref = {};
const byTaste = {};
for (const s of sorted) {
  byPref[s.prefecture] = (byPref[s.prefecture] ?? 0) + 1;
  byTaste[s.taste] = (byTaste[s.taste] ?? 0) + 1;
}
console.error(
  `shops: ${sorted.length} (confirmed ${sorted.filter((s) => s.confidence === "confirmed").length})`,
);
console.error("taste:", byTaste);
console.error(
  "top prefectures:",
  Object.entries(byPref)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 8),
);
