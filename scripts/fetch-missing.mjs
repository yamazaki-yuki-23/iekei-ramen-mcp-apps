/** 取得に失敗した都道府県だけを再取得して data/osm-raw.json にマージする。 */
import fs from "node:fs/promises";
import path from "node:path";

const TARGETS = process.argv.slice(2);
if (TARGETS.length === 0) throw new Error("usage: node scripts/fetch-missing.mjs 京都府 宮城県");

const query = (pref) => `
[out:json][timeout:180];
area["admin_level"="4"]["name"="${pref}"]->.a;
(
  nwr["cuisine"~"ramen"]["name"~"家"](area.a);
  nwr["name"~"家系|町田商店"](area.a);
);
out center tags;
`;

const file = path.join(import.meta.dirname, "..", "data", "osm-raw.json");
const existing = JSON.parse(await fs.readFile(file, "utf-8"));

for (const pref of TARGETS) {
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "User-Agent": "iekei-ramen-mcp-app/0.1 (data build script)",
    },
    body: query(pref),
  });
  if (!res.ok) {
    console.error(`${pref}: ${res.status}`);
    continue;
  }
  const { elements = [] } = await res.json();
  const before = existing.length;
  // 同じ県の既存分を入れ替える
  const kept = existing.filter((e) => e.prefecture !== pref);
  existing.length = 0;
  existing.push(...kept);
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    existing.push({ osmType: el.type, osmId: el.id, lat, lon, prefecture: pref, tags: el.tags ?? {} });
  }
  console.error(`${pref}: ${elements.length} (total ${before} -> ${existing.length})`);
}

await fs.writeFile(file, JSON.stringify(existing, null, 1));
