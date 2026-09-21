/**
 * 家系判定の正解データ（人手ラベル用）を作る。
 *
 * 質問文や閾値を変えるときの土台。今の判定（judged.json）を `current` として
 * 持たせ、try-judgments.mjs が新しい質問の結果と突き合わせる。
 *
 * 判定が割れやすいところを厚めに取るので、無作為抽出ではない。
 *   - candidate … ジャンルを判断できなかったもの。数が一番多い
 *   - 落とした  … ラーメン店ではあるが家系ではないと判断した境界事例
 *   - likely / confirmed … 取りこぼしが起きていないかの確認用
 */
import fs from "node:fs/promises";
import path from "node:path";

const DIR = path.join(import.meta.dirname, "..", "data");
const raw = JSON.parse(await fs.readFile(path.join(DIR, "osm-raw.json"), "utf-8"));
const judged = JSON.parse(await fs.readFile(path.join(DIR, "judged.json"), "utf-8"));

/**
 * 判定を変えたときに必ず見たい店と、その正解。
 * 過去に誤判定していたもので、正解が確定しているのでラベルを入れてある。
 */
const PINNED = new Map([
  ["博多ラーメン琥家", null], // 家系ではない（博多とんこつ）
  ["塩らーめん嵐家", null], // 家系ではない（塩）
  ["中華飯店菜家", null], // 家系ではない（中華料理店）
  ["横浜ラーメン 田上家", "confirmed"], // 家系。旧ロジックが空白の位置で落としていた
  ["横浜家糸ラーメン", "confirmed"], // 家系。OSM 側の誤字「家糸」
  ["魂心家", "confirmed"], // 家系。brand=幸楽苑 の誤タグで消えていた
]);

const entry = (el, bucket) => ({
  bucket,
  id: `${el.osmType}/${el.osmId}`,
  name: el.tags["name:ja"] || el.tags.name || el.tags.brand,
  prefecture: el.prefecture,
  /** 今出荷している判定。正解ではなく、比べるための基準線。 */
  current: judged[`${el.osmType}/${el.osmId}`]?.verdict ?? null,
  /**
   * 正解。try-judgments.mjs はこれで採点する。
   * "confirmed" | "likely" | "candidate" | null（家系ではない）。
   * 未記入は undefined のままにして採点から外す。
   */
  label: PINNED.get(el.tags["name:ja"] || el.tags.name || el.tags.brand),
  /** 迷った理由やメモ。質問文を直すときの手がかりになる。 */
  note: "",
  tags: el.tags,
});

const named = raw.filter((el) => {
  const t = el.tags ?? {};
  return (t["name:ja"] || t.name || t.brand) && judged[`${el.osmType}/${el.osmId}`];
});
const verdictOf = (el) => judged[`${el.osmType}/${el.osmId}`].verdict;

/** 県ごとに 1 件ずつ拾って、特定の地域に偏らないようにする。 */
function spread(items, n) {
  const byPref = new Map();
  for (const el of items) {
    if (!byPref.has(el.prefecture)) byPref.set(el.prefecture, []);
    byPref.get(el.prefecture).push(el);
  }
  const out = [];
  const queues = [...byPref.values()];
  while (out.length < n && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (out.length >= n) break;
      if (q.length) out.push(q.shift());
    }
  }
  return out;
}

const nameOf = (el) => el.tags["name:ja"] || el.tags.name || el.tags.brand;

// 同じ店名は 1 件だけ。チェーンは全国に何十店もあるので、
// 絞らないと魂心家と山岡家で評価データが埋まってしまう。
const usedNames = new Set();
const takeNew = (els) =>
  els.filter((el) => !usedNames.has(nameOf(el)) && usedNames.add(nameOf(el)));

const pinned = takeNew(named.filter((el) => PINNED.has(nameOf(el))));
const rest = named.filter((el) => !usedNames.has(nameOf(el)));
const pick = (verdict, n) =>
  takeNew(
    spread(
      rest.filter((el) => verdictOf(el) === verdict),
      n * 4,
    ),
  ).slice(0, n);

const cases = [
  ...pinned.map((el) => entry(el, "pinned")),
  ...pick("confirmed", 5).map((el) => entry(el, "confirmed")),
  ...pick("likely", 4).map((el) => entry(el, "likely")),
  ...pick("candidate", 8).map((el) => entry(el, "candidate")),
  // 家系ではないと判断して落としたが、ラーメン店ではあるもの
  ...takeNew(
    spread(
      rest.filter(
        (el) =>
          verdictOf(el) === null && judged[`${el.osmType}/${el.osmId}`].raw?.is_ramen_shop >= 0.5,
      ),
      28,
    ),
  )
    .slice(0, 7)
    .map((el) => entry(el, "dropped-ramen")),
];

const out = path.join(DIR, "eval-iekei.json");
await fs.writeFile(out, JSON.stringify(cases, null, 2) + "\n");
console.error(`${cases.length} cases -> ${path.relative(process.cwd(), out)}`);
for (const c of cases)
  console.error(`  [${c.bucket}] ${c.current ?? "drop"} ${c.prefecture} ${c.name}`);
