/**
 * data/osm-raw.json の全要素を TypeSafe で判定し、data/judged.json に保存する。
 *
 * 判定を build-dataset.mjs から切り離しているのは、毎回 API を叩きたくないため。
 * judged.json を置いておけば、データ整形だけならキー無しで回せる。
 *
 * 実行: node scripts/judge-all.mjs        （未判定・タグが変わったものだけ処理する）
 *       node scripts/judge-all.mjs --all  （全部やり直す）
 */
import fs from "node:fs/promises";
import path from "node:path";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { knownFacts, tagsFingerprint } from "./classify.mjs";
import { decide, QUESTIONS, shopState } from "./judgments.mjs";

const DIR = path.join(import.meta.dirname, "..", "data");
const OUT = path.join(DIR, "judged.json");
const raw = JSON.parse(await fs.readFile(path.join(DIR, "osm-raw.json"), "utf-8"));

const judged = process.argv.includes("--all")
  ? {}
  : await fs.readFile(OUT, "utf-8").then(JSON.parse, () => ({}));

const client = new TypeSafeClient();
const CONCURRENCY = 8;
const usage = { input: 0, output: 0 };

let stale = 0;
const todo = raw.filter((el) => {
  const t = el.tags ?? {};
  if (!(t["name:ja"] || t.name || t.brand)) return false;
  const prev = judged[`${el.osmType}/${el.osmId}`];
  if (!prev) return true;
  if (prev.tagsFingerprint === tagsFingerprint(t)) return false;
  stale++;
  return true;
});
console.error(
  `判定対象 ${todo.length} / 全 ${raw.length} 件` +
    (stale > 0 ? `（うち ${stale} 件はタグが変わったので判定し直す）` : ""),
);

let done = 0;
async function judge(el) {
  const id = `${el.osmType}/${el.osmId}`;
  const res = await client.systemOne({ state: shopState(el.tags), questions: QUESTIONS });
  usage.input += res.usage.input_tokens;
  usage.output += res.usage.output_tokens;
  const a = res.answers;
  const d = decide(a, knownFacts(el.tags));
  judged[id] = {
    tagsFingerprint: tagsFingerprint(el.tags),
    verdict: d.verdict,
    taste: d.taste,
    why: d.why,
    // あとで閾値を変えたときに再実行しなくて済むよう、生の確率を残す。
    raw: {
      is_ramen_shop: a.is_ramen_shop.noul,
      name_declares_iekei: a.name_declares_iekei.noul,
      known_iekei_brand: a.known_iekei_brand.noul,
      yago_is_ya: a.yago_is_ya.noul,
      genre: a.genre.choice,
      genre_p: a.genre.probabilities,
    },
  };
  if (++done % 50 === 0) console.error(`  ${done}/${todo.length}`);
}

for (let i = 0; i < todo.length; i += CONCURRENCY) {
  await Promise.all(todo.slice(i, i + CONCURRENCY).map(judge));
  // 途中で落ちても続きから再開できるよう、こまめに書く。
  if (i % (CONCURRENCY * 10) === 0) await fs.writeFile(OUT, JSON.stringify(judged, null, 1) + "\n");
}
await fs.writeFile(OUT, JSON.stringify(judged, null, 1) + "\n");

const counts = {};
for (const v of Object.values(judged))
  counts[v.verdict ?? "drop"] = (counts[v.verdict ?? "drop"] ?? 0) + 1;
console.error(`\n判定済み ${Object.keys(judged).length} 件:`, counts);
console.error(
  `tokens in=${usage.input} out=${usage.output} / 概算 $${((usage.input / 1e6) * 0.042).toFixed(4)}`,
);
