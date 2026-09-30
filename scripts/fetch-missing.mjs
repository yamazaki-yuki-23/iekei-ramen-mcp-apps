/**
 * 取得に失敗した都道府県だけを再取得して data/osm-raw.json にマージする。
 *
 * 使い方: node scripts/fetch-missing.mjs 京都府 宮城県
 *
 * **クエリと取得の手順は overpass-query.mjs から取る。** ここに写しを置くと、
 * 条件を足したときに全国取得側だけが新しくなり、取り直した県だけ古い基準で
 * 拾ったデータが混ざる（実際にそうなっていた）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fetchPref, toElement } from "./overpass-query.mjs";

const TARGETS = process.argv.slice(2);
if (TARGETS.length === 0) throw new Error("usage: node scripts/fetch-missing.mjs 京都府 宮城県");

const file = path.join(import.meta.dirname, "..", "data", "osm-raw.json");
const existing = JSON.parse(await fs.readFile(file, "utf-8"));

let failed = 0;
for (const pref of TARGETS) {
  let elements;
  try {
    elements = await fetchPref(pref);
  } catch (error) {
    // 1 県落ちても続ける。取れた県は保存されるので、残りだけを指定し直せる。
    failed += 1;
    console.error(`${pref}: ${error.message}`);
    continue;
  }
  const before = existing.length;
  // 同じ県の既存分を入れ替える。
  const kept = existing.filter((e) => e.prefecture !== pref);
  existing.length = 0;
  existing.push(...kept, ...elements.map((el) => toElement(el, pref)).filter(Boolean));
  console.error(`${pref}: ${elements.length} (total ${before} -> ${existing.length})`);
}

await fs.writeFile(file, JSON.stringify(existing, null, 1));

/*
 * **取れなかった県が残っていたら異常終了する。**
 * 0 で返すと、手順どおりに data:judge へ進んだときに、県ごと欠けた
 * osm-raw.json を正しいものとして扱ってしまう。このファイルは gitignore なので
 * 控えが無く、欠けたまま上書きすると取り直すしかない（実際にそうなった）。
 */
if (failed > 0) {
  console.error(`\n${failed} 県が取れませんでした。同じコマンドで残りを指定し直してください。`);
  process.exitCode = 1;
}
