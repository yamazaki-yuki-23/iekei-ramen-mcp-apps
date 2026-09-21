/**
 * 同じ店舗が 2 件入っているものを見つけて data/duplicates.json に書く。
 *
 * 候補の絞り込みはコードでやる（PAIR_RADIUS_M 以内のペアだけ）。
 * 全組み合わせは 28 万通りあるが、実際に判定にかけるのは数十ペアで済む。
 * 判定そのものは TypeSafe の Score 1 問。
 *
 * 家系かどうかの判定結果には依存しない。閾値を変えて一覧に載る店が増えたときに
 * 「重複の判定だけ古い」状態になるのを避けるため、どちらを落とすかの決定は
 * build-dataset.mjs が現在の判定を見て行う。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { nearbyPairs, pairFingerprint } from "./classify.mjs";
import { PAIR_QUESTION, PAIR_RADIUS_M, pairState, SAME_SHOP_AT } from "./judgments.mjs";

const DIR = path.join(import.meta.dirname, "..", "data");
const raw = JSON.parse(await fs.readFile(path.join(DIR, "osm-raw.json"), "utf-8"));
const pairs = nearbyPairs(raw, PAIR_RADIUS_M);
console.error(`${PAIR_RADIUS_M}m 以内のペア ${pairs.length} 組`);

const client = new TypeSafeClient();
const usage = { input: 0, output: 0 };
const results = [];

async function judge(p) {
  const res = await client.systemOne({
    state: pairState(p.a, p.b, p.d),
    questions: PAIR_QUESTION,
  });
  usage.input += res.usage.input_tokens;
  usage.output += res.usage.output_tokens;
  const s = res.answers.same_shop;
  results.push({
    a: `${p.a.osmType}/${p.a.osmId}`,
    b: `${p.b.osmType}/${p.b.osmId}`,
    // 判定に使った入力の指紋。build-dataset が今のデータと突き合わせる。
    fingerprint: pairFingerprint(p.a, p.b),
    aName: p.a.tags["name:ja"] || p.a.tags.name,
    bName: p.b.tags["name:ja"] || p.b.tags.name,
    distanceM: Math.round(p.d),
    score: s.score,
    confidence: s.confidence,
  });
}

const CONCURRENCY = 6;
for (let i = 0; i < pairs.length; i += CONCURRENCY) {
  await Promise.all(pairs.slice(i, i + CONCURRENCY).map(judge));
}

// どちらを落とすかはここでは決めない。落とすと一覧から消えるので、
// その判断は現在の判定を持っている build-dataset.mjs に任せる。
await fs.writeFile(
  path.join(DIR, "duplicates.json"),
  JSON.stringify({ pairs: results.toSorted((x, y) => y.score - x.score) }, null, 1) + "\n",
);

// 表示のためだけに閾値を当てる。保存はしない（build-dataset が都度決める）。
const isSame = (r) => r.score >= SAME_SHOP_AT;
console.error(`\n同一と判定 ${results.filter(isSame).length} 組`);
console.error("--- 判定の内訳 ---");
for (const r of results.toSorted((x, y) => y.score - x.score)) {
  console.error(
    `${r.score.toFixed(2)} (conf ${r.confidence.toFixed(2)}) ${isSame(r) ? "同一" : "別"} ${r.distanceM}m  ${r.aName} / ${r.bName}`,
  );
}
console.error(`\ntokens in=${usage.input} / 概算 $${((usage.input / 1e6) * 0.042).toFixed(4)}`);
