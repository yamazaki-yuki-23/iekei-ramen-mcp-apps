/**
 * judged.json に保存した確率だけを使って判定をやり直す。API は叩かない。
 *
 * 閾値を動かしたときに再実行するのはこれ。判断の材料（確率）と
 * 判断の方針（閾値）を分けておくと、方針の変更が無料になる。
 *
 * 指紋には触らない。ここで現在のタグから指紋を付け直すと、古い確率のまま
 * 「判定済み」の印だけが新しくなり、judge-all が再判定を永久に飛ばしてしまう。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { decide } from "./judgments.mjs";
import { knownFacts, tagsFingerprint } from "./classify.mjs";

const DIR = path.join(import.meta.dirname, "..", "data");
const OUT = path.join(DIR, "judged.json");
const raw = JSON.parse(await fs.readFile(path.join(DIR, "osm-raw.json"), "utf-8"));
const judged = JSON.parse(await fs.readFile(OUT, "utf-8"));
const tagsById = new Map(raw.map((el) => [`${el.osmType}/${el.osmId}`, el.tags ?? {}]));

/** 保存した数値を、TypeSafe の回答と同じ形に戻す。 */
const asAnswers = (r) => ({
  is_ramen_shop: { noul: r.is_ramen_shop },
  name_declares_iekei: { noul: r.name_declares_iekei },
  known_iekei_brand: { noul: r.known_iekei_brand },
  yago_is_ya: { noul: r.yago_is_ya },
  genre: { choice: r.genre, probabilities: r.genre_p },
});

const before = {};
const after = {};
let moved = 0;
let outdated = 0;
for (const [id, v] of Object.entries(judged)) {
  before[v.verdict ?? "drop"] = (before[v.verdict ?? "drop"] ?? 0) + 1;
  const tags = tagsById.get(id) ?? {};
  // 判定に使ったタグと今のタグが違うなら、確率そのものが古い。
  // ここでは直せないので数えて知らせるだけにする。
  if (v.tagsFingerprint && v.tagsFingerprint !== tagsFingerprint(tags)) outdated++;
  const d = decide(asAnswers(v.raw), knownFacts(tags));
  if (d.verdict !== v.verdict) moved++;
  Object.assign(v, { verdict: d.verdict, taste: d.taste, why: d.why });
  after[d.verdict ?? "drop"] = (after[d.verdict ?? "drop"] ?? 0) + 1;
}

await fs.writeFile(OUT, JSON.stringify(judged, null, 1) + "\n");
console.error("before:", before);
console.error("after :", after);
console.error(`動いたもの ${moved} 件`);
if (outdated > 0) {
  console.error(
    `\n警告: ${outdated} 件はタグが変わっています。確率が古いままなので、` +
      `npm run data:judge を実行してください。`,
  );
}
