/**
 * 正解データに対して、今の判定（judged.json 由来の current）と
 * 今の質問文での判定を突き合わせる。質問文や閾値を変えるときの実験用。
 * 結果は data/eval-result.json に残す。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { knownFacts } from "./classify.mjs";
import { decide, QUESTIONS, shopState } from "./judgments.mjs";

const DIR = path.join(import.meta.dirname, "..", "data");
const cases = JSON.parse(await fs.readFile(path.join(DIR, "eval-iekei.json"), "utf-8"));
const client = new TypeSafeClient();

/** 一度に投げすぎない程度の並列度。レート上限は 1,200 req/min なので余裕がある。 */
const CONCURRENCY = 6;
const usage = { input: 0, output: 0 };

async function run(c) {
  const res = await client.systemOne({ state: shopState(c.tags), questions: QUESTIONS });
  usage.input += res.usage.input_tokens;
  usage.output += res.usage.output_tokens;
  const d = decide(res.answers, knownFacts(c.tags));
  return {
    ...c,
    typesafe: d.verdict,
    typesafeTaste: d.taste,
    why: d.why,
    answers: {
      is_ramen_shop: res.answers.is_ramen_shop.noul,
      name_declares_iekei: res.answers.name_declares_iekei.noul,
      known_iekei_brand: res.answers.known_iekei_brand.noul,
      yago_is_ya: res.answers.yago_is_ya.noul,
      genre: res.answers.genre.choice,
      genre_p: res.answers.genre.probabilities,
      genre_conf: res.answers.genre.confidence,
    },
  };
}

const results = [];
for (let i = 0; i < cases.length; i += CONCURRENCY) {
  results.push(...(await Promise.all(cases.slice(i, i + CONCURRENCY).map(run))));
}

await fs.writeFile(path.join(DIR, "eval-result.json"), JSON.stringify(results, null, 2) + "\n");

const v = (x) => x ?? "drop";
const detail = (r) =>
  `[${r.answers.genre} ${(r.answers.genre_p[r.answers.genre] ?? 0).toFixed(2)}] ` +
  `ramen=${r.answers.is_ramen_shop} yago=${r.answers.yago_is_ya} / ${r.why}`;

/**
 * 正解は人手ラベル。`current` は今出荷している判定で、比較対象ではなく基準線。
 * current を正解として扱うと、今の誤りを再現する質問文ほど「一致」が高く出て、
 * 誤りを直す変更が「不一致」として報告されてしまう。
 */
// null は「家系ではない」という正解なので、キーの有無で見る。
// 未記入は JSON に label ごと出ない（undefined は落ちる）。
const labeled = results.filter((r) => Object.hasOwn(r, "label"));

if (labeled.length === 0) {
  console.log(
    `人手ラベルが 1 件も入っていません（${results.length} 件中）。` +
      `data/eval-iekei.json の label を埋めると正答率が出ます。\n` +
      `以下は今の判定（current）との差分です。正解を意味しません。\n`,
  );
  for (const r of results.filter((x) => x.current !== x.typesafe)) {
    console.log(
      `${v(r.current).padEnd(9)} -> ${v(r.typesafe).padEnd(9)} ${r.name}`.padEnd(52) + detail(r),
    );
  }
} else {
  const hit = labeled.filter((r) => r.label === r.typesafe);
  const baseline = labeled.filter((r) => r.label === r.current);
  console.log(
    `正答 ${hit.length}/${labeled.length}（今の判定は ${baseline.length}/${labeled.length}）`,
  );
  if (labeled.length < results.length) {
    console.log(`※ ラベル未記入 ${results.length - labeled.length} 件は採点から除いた`);
  }
  console.log("\n--- 誤ったもの ---");
  for (const r of labeled.filter((x) => x.label !== x.typesafe)) {
    console.log(
      `正解 ${v(r.label).padEnd(9)} 出力 ${v(r.typesafe).padEnd(9)} (今 ${v(r.current)}) ${r.name}`.padEnd(
        64,
      ) + detail(r),
    );
  }
  console.log("\n--- 今の判定が誤っていて、新しい質問文で直ったもの ---");
  for (const r of labeled.filter((x) => x.label !== x.current && x.label === x.typesafe)) {
    console.log(
      `正解 ${v(r.label).padEnd(9)} (今 ${v(r.current)} → 出力 ${v(r.typesafe)}) ${r.name}`,
    );
  }
}

const cost = (usage.input / 1e6) * 0.042;
console.log(`\ntokens in=${usage.input} out=${usage.output} / 概算 $${cost.toFixed(5)}`);
