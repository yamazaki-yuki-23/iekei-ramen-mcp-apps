/**
 * OpenStreetMap (Overpass API) から全国の家系ラーメン店候補を取得し、
 * 都道府県つきの静的データ data/shops.json を生成する。
 *
 * 実行: node scripts/fetch-shops.mjs
 * OSM データは ODbL。出典表示が必要。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fetchPref, toElement } from "./overpass-query.mjs";

const PREFECTURES = [
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県",
];

const out = [];
// Overpass の同時実行スロットを使い切らないよう、少数ずつ並列に投げる。
const CONCURRENCY = 3;
const queue = [...PREFECTURES];
let done = 0;
const failed = [];

async function worker(slot) {
  while (queue.length > 0) {
    const pref = queue.shift();
    try {
      const els = await fetchPref(pref, slot);
      for (const el of els) {
        const element = toElement(el, pref);
        if (element) out.push(element);
      }
      console.error(`[${++done}/${PREFECTURES.length}] ${pref}: ${els.length}`);
    } catch (e) {
      failed.push(pref);
      console.error(`[${++done}/${PREFECTURES.length}] ${pref}: FAILED ${e.message}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

const file = path.join(import.meta.dirname, "..", "data", "osm-raw.json");
await fs.writeFile(file, JSON.stringify(out, null, 1));
console.error(`\ntotal raw: ${out.length} -> ${file}`);

/*
 * **落ちた県が 1 つでもあれば異常終了する。**
 *
 * 成功と同じ終了コードで返すと、県ごと欠けた osm-raw.json を正しいものとして
 * 次の工程（data:judge）へ渡してしまう。このファイルは gitignore なので控えが
 * 無く、欠けたまま上書きすると取り直すしかない（実際に 752 → 435 件にした）。
 */
if (failed.length > 0) {
  console.error(
    `\n${failed.length} 県が取れませんでした。` +
      `次を実行して埋めてください:\n  node scripts/fetch-missing.mjs ${failed.join(" ")}`,
  );
  process.exitCode = 1;
}
