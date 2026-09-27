/**
 * 座標から市区町村・町名を引く（逆ジオコーディング）。
 *
 * **OSM の店舗タグには住所がほとんど入っていない。** 558 件のうち市区町村を
 * 持つのは 82 件だけで、同名のチェーン店（東京都の町田商店 14 店など）は
 * 1 件も持っていない。店名しか出せないと、別の店が同じ店に見える。
 *
 * **判定より後、整形（data:build）より前に実行する。** 判定済みの結果から
 * 「載る店」を組み立てて、そのうち住所の欠けているものだけを引く。
 * shops.json を見に行く作りにすると、整形 → 逆引き → もう一度整形、という
 * 二度手間になる（Codex の指摘で気付いた）。
 *
 * 使い方:
 *   node scripts/fill-areas.mjs           # 足りない分だけ引く
 *   node scripts/fill-areas.mjs --limit 5 # 動作確認（5 件だけ）
 *
 * **1 秒に 1 回を超えない。** Nominatim の利用規約の上限で、破ると弾かれる。
 */
import { rename, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { toShop } from "./classify.mjs";
import { readJson } from "./read-json.mjs";

const RAW = new URL("../data/osm-raw.json", import.meta.url);
const JUDGED = new URL("../data/judged.json", import.meta.url);
const AREAS = new URL("../data/areas.json", import.meta.url);
const ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
/** 規約の上限は 1 req/s。余裕を持たせる。 */
const INTERVAL_MS = 1200;
/** 番地まで降りない。**店の位置を特定するのではなく、見分けを付けるため。** */
const ZOOM = 16;
/** 座標が変わったと見なす差。緯度経度の約 1m。 */
const MOVED = 0.00001;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 貯めた地名を保存する。**書き込みの途中で止まっても壊れないように**、
 * 別名で書いてから置き換える（保存中に止めると、次の実行で「壊れている」と
 * 判定されて止まるため）。
 */
async function saveAreas(areas) {
  const temporary = new URL("../data/areas.json.tmp", import.meta.url);
  await writeFile(temporary, `${JSON.stringify(areas, null, 2)}\n`);
  await rename(temporary, AREAS);
}

/**
 * 逆引きの応答から、人が見分けられる 2 つを取り出す。
 *
 * `city` は東京 23 区なら区、それ以外は市町村。`area` は町名。
 * **同じ市に同名の店が 2 つある**ことがあるので（町田市の町田商店）、
 * 町名まで拾っておく。
 *
 * **都道府県名は市区町村として使わない。** Nominatim は町（瑞穂町など）の
 * 住所で `city` に「東京都」を入れてくることがあり、そのまま使うと画面に
 * 「東京都 東京都 駒形富士山」と出る（実測。Codex の指摘で気付いた）。
 * 同じ応答に `town` として正しい値が入っているので、そちらを採る。
 */
export function pickArea(address, prefecture) {
  const usable = (value) => Boolean(value) && value !== prefecture;
  const city =
    [address.city, address.town, address.village, address.city_district, address.county].find(
      usable,
    ) ?? null;
  // 同じ語が 2 つ並ぶと読みにくいだけなので落とす。
  const area =
    [address.neighbourhood, address.quarter, address.suburb, address.city_district].find(
      (value) => usable(value) && value !== city,
    ) ?? null;
  return { city, area };
}

async function reverse(lat, lon, prefecture) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: "jsonv2",
    "accept-language": "ja",
    zoom: String(ZOOM),
  });
  const response = await fetch(`${ENDPOINT}?${params}`, {
    headers: { "User-Agent": "iekei-ramen-mcp-apps/0.1 (data build script)" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return pickArea(body.address ?? {}, prefecture);
}

/**
 * もう一度引く必要があるか。
 *
 * **座標が動いていたら引き直す。** OSM は同じ ID のまま位置を直すことがある。
 * 貯めたものをそのまま使い続けると、**いまの座標と合わない地名**を出し続ける
 * 古い形式（座標を持たない項目）も引き直す。
 *
 * **欠けたままの写しも引き直す。** 町名が取れなかった項目を「取得済み」として
 * 扱うと、あとから OSM 側に町名が入っても二度と拾えない。同じ市に同名の店が
 * 2 つあるとき、その 2 つが永久に見分けられないままになる。引き直すのは欠けて
 * いるものだけなので、取れない場所が残っていても数件で済む。
 */
export function needsFetch(cached, lat, lon) {
  if (!cached) return true;
  if (!cached.city || !cached.area) return true;
  return isStale(cached, lat, lon);
}

/**
 * 貯めた地名が、いまの座標と食い違っているか。
 *
 * **食い違ったまま引き直せなかったら捨てる。** 引き直しが失敗したとき
 * （429 や通信の失敗）に古い写しを残すと、`data:build` がそれを新しい座標へ
 * そのまま当ててしまい、**違う場所の地名を載せた一覧が出る**。
 * 地名が空なら「市区町村が入っていない店」として data:build が数えるので、
 * 黙って間違うより気付ける。
 */
export function isStale(cached, lat, lon) {
  if (!cached) return false;
  // 座標を持たない古い形式は、合っているか確かめようがない。
  if (typeof cached.lat !== "number" || typeof cached.lon !== "number") return true;
  return Math.abs(cached.lat - lat) > MOVED || Math.abs(cached.lon - lon) > MOVED;
}

/**
 * ここから下は**直接実行したときだけ**動かす。
 *
 * 読み込んだだけで走ると、テストから import しただけで API を叩き、
 * data/areas.json まで書き換える（実際にそうなっていた）。
 */
async function main() {
  const raw = await readJson(RAW);
  const judged = await readJson(JUDGED);
  const areas = await readJson(AREAS, { optional: true });

  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg === -1 ? Infinity : Number(process.argv[limitArg + 1]);

  /*
   * 引くのは「一覧に載る店のうち、市区町村か町名のどちらかが欠けているもの」。
   *
   * **片方だけ持っている店も引く。** 市区町村しか無い店を飛ばすと、同じ市に
   * 同名の店が 2 つあるときに同じ文字列のままになり、見分けが付かない。
   * OSM のタグは上書きしないので（整形側で「欠けているところだけ」埋める）、
   * 余分に引いても表示が現地の入力より悪くなることはない。
   */
  const targets = [];
  for (const el of raw) {
    const id = `${el.osmType}/${el.osmId}`;
    const shop = toShop(el, judged[id]);
    if (!shop) continue;
    if (shop.city && shop.address) continue;
    if (!needsFetch(areas[id], el.lat, el.lon)) continue;
    targets.push({
      id,
      name: shop.name,
      lat: el.lat,
      lon: el.lon,
      prefecture: el.prefecture,
      // 引き直せなかったときに捨てるかどうかの判断は、ここで決めておく。
      stale: isStale(areas[id], el.lat, el.lon),
    });
    if (targets.length >= limit) break;
  }

  console.error(`対象 ${targets.length} 件（既に ${Object.keys(areas).length} 件を取得済み）`);

  let done = 0;
  let failed = 0;
  for (const target of targets) {
    try {
      areas[target.id] = {
        ...(await reverse(target.lat, target.lon, target.prefecture)),
        lat: target.lat,
        lon: target.lon,
      };
      done += 1;
    } catch (error) {
      // 1 件落ちても止めない。次に実行したときに、残りだけを引き直せる。
      failed += 1;
      /*
       * **古い写しは残さない。** 座標が動いた店を引き直せなかったとき、
       * そのまま残すと data:build が違う場所の地名を当てる。空にしておけば
       * 「市区町村が入っていない店」として数えられ、気付ける。
       */
      if (target.stale) delete areas[target.id];
      console.error(`  失敗 ${target.id} (${target.name}): ${error.message}`);
    }
    if (done % 25 === 0 && done > 0) {
      await saveAreas(areas);
      console.error(`  ${done}/${targets.length} 件…`);
    }
    await sleep(INTERVAL_MS);
  }

  await saveAreas(areas);
  console.error(`完了: ${done} 件取得 / ${failed} 件失敗 / 合計 ${Object.keys(areas).length} 件`);
  /*
   * **失敗が残っていたら異常終了する。** 手順書どおりに続けて data:build を
   * 走らせると、欠けたまま公開されてしまう。取れた分は保存済みなので、
   * もう一度走らせれば残りだけを引き直せる。
   */
  if (failed > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
