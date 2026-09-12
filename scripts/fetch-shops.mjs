/**
 * OpenStreetMap (Overpass API) から全国の家系ラーメン店候補を取得し、
 * 都道府県つきの静的データ data/shops.json を生成する。
 *
 * 実行: node scripts/fetch-shops.mjs
 * OSM データは ODbL。出典表示が必要。
 */
import fs from "node:fs/promises";
import path from "node:path";

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

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const query = (pref) => `
[out:json][timeout:180];
area["admin_level"="4"]["name"="${pref}"]->.a;
(
  nwr["cuisine"~"ramen"]["name"~"家"](area.a);
  nwr["name"~"家系|町田商店"](area.a);
);
out center tags;
`;

async function fetchPref(pref, attempt = 0) {
  const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "User-Agent": "iekei-ramen-mcp-app/0.1 (data build script)",
    },
    body: query(pref),
  });
  if (!res.ok) {
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      return fetchPref(pref, attempt + 1);
    }
    throw new Error(`${pref}: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return json.elements ?? [];
}

const out = [];
// Overpass の同時実行スロットを使い切らないよう、少数ずつ並列に投げる。
const CONCURRENCY = 3;
const queue = [...PREFECTURES];
let done = 0;

async function worker(slot) {
  while (queue.length > 0) {
    const pref = queue.shift();
    try {
      const els = await fetchPref(pref, slot);
      for (const el of els) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) continue;
        out.push({
          osmType: el.type,
          osmId: el.id,
          lat,
          lon,
          prefecture: pref,
          tags: el.tags ?? {},
        });
      }
      console.error(`[${++done}/${PREFECTURES.length}] ${pref}: ${els.length}`);
    } catch (e) {
      console.error(`[${++done}/${PREFECTURES.length}] ${pref}: FAILED ${e.message}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

const file = path.join(import.meta.dirname, "..", "data", "osm-raw.json");
await fs.writeFile(file, JSON.stringify(out, null, 1));
console.error(`\ntotal raw: ${out.length} -> ${file}`);
