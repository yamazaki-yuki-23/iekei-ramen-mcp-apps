/**
 * data/osm-raw.json と data/judged.json を突き合わせて data/shops.json を生成する。
 *
 * 家系かどうかの判定は judge-all.mjs（TypeSafe）が済ませてある。
 * ここは整形と重複除去だけなので、API キーは要らない。
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  nearbyPairs,
  pairFingerprint,
  resolveDuplicates,
  tagsFingerprint,
  toShop,
} from "./classify.mjs";
import { PAIR_RADIUS_M, SAME_SHOP_AT } from "./judgments.mjs";

const DIR = path.join(import.meta.dirname, "..", "data");
const raw = JSON.parse(await fs.readFile(path.join(DIR, "osm-raw.json"), "utf-8"));
const judged = JSON.parse(await fs.readFile(path.join(DIR, "judged.json"), "utf-8"));
// 重複判定の結果。find-duplicates.mjs が書く。
const judgedPairs = await fs.readFile(path.join(DIR, "duplicates.json"), "utf-8").then(
  (t) => new Map(JSON.parse(t).pairs.map((p) => [p.fingerprint, p])),
  () => new Map(),
);

// 今のデータから候補ペアを数え直し、すべて判定済みかを確かめる。
// 座標や店名が変わると指紋が変わるので、近くなった・遠くなった・中身が
// 変わったペアはここで漏れとして出る。dedupe を飛ばしたときも同じ。
const currentPairs = nearbyPairs(raw, PAIR_RADIUS_M);
const currentFingerprints = new Set(currentPairs.map((p) => pairFingerprint(p.a, p.b)));
const missingPairs = currentPairs.filter((p) => !judgedPairs.has(pairFingerprint(p.a, p.b)));
if (missingPairs.length > 0) {
  const sample = missingPairs
    .slice(0, 5)
    .map(
      (p) =>
        `${Math.round(p.d)}m ${p.a.tags["name:ja"] || p.a.tags.name} / ${p.b.tags["name:ja"] || p.b.tags.name}`,
    )
    .join("\n  ");
  throw new Error(
    `重複判定が無い、または古いペアが ${missingPairs.length} 組あります。先に npm run data:dedupe を実行してください。\n  ${sample}` +
      (missingPairs.length > 5 ? `\n  ...他 ${missingPairs.length - 5} 組` : ""),
  );
}

/**
 * どちらを落とすかはここで決める。重複判定そのものは家系判定に依存しないので、
 * 閾値を変えて一覧に載る店が増えても、重複除去だけ古いままにはならない。
 *
 * 効かせるのは今も候補ペアであるものだけ。2 店が離れれば別店舗として扱うべきで、
 * 過去に同一と判定した記録が残っていても適用してはいけない。
 *
 * 同一かどうかは保存済みの score から都度決める。判定の材料（score）と
 * 方針（SAME_SHOP_AT）を分けておけば、閾値を変えても再判定が要らない。
 *
 * 両方が一覧に載るときだけ効かせる。片方しか載らないなら重複は起きないし、
 * 残すつもりの記録を先に落としてしまう事故も防げる。
 */
const isKept = (id) => Boolean(judged[id]?.verdict);

/**
 * 重複を畳むときに残す優先度。判定の強さが先で、同じならタグの多さ。
 *
 * タグ数だけで決めると、情報量の多い candidate が confirmed を置き換えてしまう。
 * 同じ店の 2 件で判定が割れるのは片方のタグに手がかりがあったからなので、
 * 強い判定を持つ記録のほうを残す。
 */
const VERDICT_RANK = { confirmed: 3, likely: 2, candidate: 1 };
const keepScore = new Map(
  raw.map((el) => {
    const id = `${el.osmType}/${el.osmId}`;
    const rank = VERDICT_RANK[judged[id]?.verdict] ?? 0;
    return [id, rank * 1000 + Object.keys(el.tags ?? {}).length];
  }),
);
const samePairs = [...judgedPairs.entries()]
  .filter(([fp, x]) => currentFingerprints.has(fp) && x.score >= SAME_SHOP_AT)
  .map(([, x]) => x)
  .filter((x) => isKept(x.a) && isKept(x.b));
const duplicates = resolveDuplicates(samePairs, keepScore);

// 判定が無い要素を黙って落とすと、一見成功したまま歯抜けのデータができる。
// 判定が古い要素を黙って使うと、今のタグに古い判定が貼られたデータができる。
// どちらも「成功したように見える誤ったデータ」なので、ここで止める。
// data:judge が途中で落ちた場合もこれで気づける。
const needsJudging = raw.filter((el) => {
  const t = el.tags ?? {};
  if (!(t["name:ja"] || t.name || t.brand)) return false;
  const prev = judged[`${el.osmType}/${el.osmId}`];
  // 指紋の比較方法は judge-all.mjs の再判定条件と同じにしておくこと。
  return !prev || prev.tagsFingerprint !== tagsFingerprint(t);
});
if (needsJudging.length > 0) {
  const sample = needsJudging
    .slice(0, 5)
    .map((el) => `${el.osmType}/${el.osmId} ${el.tags["name:ja"] || el.tags.name}`)
    .join("\n  ");
  throw new Error(
    `判定が無い、または古い要素が ${needsJudging.length} 件あります。先に npm run data:judge を実行してください。\n  ${sample}` +
      (needsJudging.length > 5 ? `\n  ...他 ${needsJudging.length - 5} 件` : ""),
  );
}

const seen = new Set();
const shops = [];

for (const el of raw) {
  const id = `${el.osmType}/${el.osmId}`;
  if (duplicates.has(id)) continue;

  const shop = toShop(el, judged[id]);
  if (!shop) continue;

  // 名前も座標も完全に一致するものは、判定にかけるまでもなく重複。
  // 近いが少しずれる node/way の重複は duplicates.json が持っている。
  const key = `${shop.name}@${shop.lat.toFixed(4)},${shop.lon.toFixed(4)}`;
  if (seen.has(key)) continue;
  seen.add(key);

  shops.push(shop);
}

// 確度の高い順、その中は都道府県・店名順。
const ORDER = { confirmed: 0, likely: 1, candidate: 2 };
const sorted = shops.toSorted(
  (a, b) =>
    ORDER[a.confidence] - ORDER[b.confidence] ||
    a.prefecture.localeCompare(b.prefecture, "ja") ||
    a.name.localeCompare(b.name, "ja"),
);

await fs.writeFile(path.join(DIR, "shops.json"), JSON.stringify(sorted));

const byPref = {};
const byTaste = {};
for (const s of sorted) {
  byPref[s.prefecture] = (byPref[s.prefecture] ?? 0) + 1;
  byTaste[s.taste] = (byTaste[s.taste] ?? 0) + 1;
}
const byConfidence = {};
for (const s of sorted) byConfidence[s.confidence] = (byConfidence[s.confidence] ?? 0) + 1;
console.error(`shops: ${sorted.length}`, byConfidence, `/ 重複除去 ${duplicates.size} 件`);
console.error("taste:", byTaste);
console.error(
  "top prefectures:",
  Object.entries(byPref)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 8),
);
