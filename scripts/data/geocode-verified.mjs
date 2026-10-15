/**
 * 確かめた記録（data/verified.json）のうち、今のデータに無い店の座標を、公式の住所から引く。
 *
 * **住所から座標を引くのは国土地理院の住所検索。** Nominatim は日本の番地をほとんど持たず、
 * 試した住所（盛岡市津志田南1-1-16 など）は 1 件も返らなかった。国土地理院は番地か街区
 * （「一丁目１番」）まで当たり、当たらなかったときは町や字までで返す。どこまで当たったかが
 * 返ってくる名前に出るので、番地の精度で当たった店だけを使える（距離は直線距離で出すので、
 * 町の中心に置くと誤る）。
 *
 * 市区町村は、引いた座標から Nominatim で引く（data:areas と同じ。一覧の市区町村の
 * まとめ方を、今の店と揃えるため）。
 *
 * 使い方:
 *   node scripts/data/geocode-verified.mjs           # まだ引いていない店だけ
 *   node scripts/data/geocode-verified.mjs --limit 5 # 動作確認（5 件だけ）
 *
 * **引いた結果は data/verified-geo.json に残し、毎回は引き直さない。** 番地の精度で
 * 当たらなかった店も残す（何度引いても同じなので）。住所を直した店は、鍵が変わるので引き直す。
 * どちらのサービスにも 1 秒に 1 件より速く問い合わせない。
 */
import { rename, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { reverse } from "./fill-areas.mjs";
import { readJson } from "./read-json.mjs";
import { geoKey, isPrecise, toAdd } from "./verified-shops.mjs";

const VERIFIED = new URL("../../data/verified.json", import.meta.url);
const GEO = new URL("../../data/verified-geo.json", import.meta.url);
const ENDPOINT = "https://msearch.gsi.go.jp/address-search/AddressSearch";
const INTERVAL_MS = 1200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 問い合わせ 1 回ごとに、**成否にかかわらず**間を空ける。失敗したときだけ待たずに次へ進むと、
 * 相手が絞っている（429 など）ときほど連打になり、残りが全部失敗する。
 */
export async function paced(request, wait = () => sleep(INTERVAL_MS)) {
  try {
    return await request();
  } finally {
    await wait();
  }
}
async function search(query) {
  const response = await fetch(`${ENDPOINT}?${new URLSearchParams({ q: query })}`, {
    headers: { "User-Agent": "iekei-ramen-mcp-apps/0.1 (data build script)" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const [first] = await response.json();
  if (!first) return null;
  const [lon, lat] = first.geometry.coordinates;
  return { title: first.properties.title, lat, lon };
}

async function save(geo) {
  const temporary = new URL("../../data/verified-geo.json.tmp", import.meta.url);
  await writeFile(temporary, `${JSON.stringify(geo, null, 2)}\n`);
  await rename(temporary, GEO);
}

async function main() {
  const records = await readJson(VERIFIED);
  const geo = await readJson(GEO, { optional: true });
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg === -1 ? Infinity : Number(process.argv[limitArg + 1]);

  const targets = toAdd(records)
    .filter((r) => !geo[geoKey(r)])
    .slice(0, limit);
  console.error(`対象 ${targets.length} 件（既に ${Object.keys(geo).length} 件を引いた）`);

  let failed = 0;
  for (const [i, record] of targets.entries()) {
    try {
      const hit = await paced(() => search(geoKey(record)));
      if (!hit || !isPrecise(hit.title, record)) {
        geo[geoKey(record)] = { precise: false, title: hit?.title ?? null };
      } else {
        const { city } = await paced(() => reverse(hit.lat, hit.lon, record.prefecture));
        geo[geoKey(record)] = { precise: true, title: hit.title, lat: hit.lat, lon: hit.lon, city };
      }
    } catch (error) {
      // 1 件落ちても止めない。次に実行すると、残りだけを引く。
      failed += 1;
      console.error(`  失敗 ${record.name}: ${error.message}`);
    }
    if ((i + 1) % 25 === 0) {
      await save(geo);
      console.error(`  ${i + 1}/${targets.length} 件…`);
    }
  }
  await save(geo);

  const results = toAdd(records).map((r) => geo[geoKey(r)]);
  const precise = results.filter((g) => g?.precise).length;
  console.error(
    `完了: 番地の精度 ${precise} 件 / 当たらなかった ${results.filter((g) => g && !g.precise).length} 件 / 失敗 ${failed} 件`,
  );
  if (failed > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
