/** #83の比較用正本と同じ入力で測る。時間は参考値、回帰ゲートは操作回数だけ。 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { clusterShops } from "../src/lib/cluster.ts";
import { clusterShops as reference } from "../tests/fixtures/cluster-reference.ts";

const shops = JSON.parse(readFileSync(new URL("../data/shops.json", import.meta.url), "utf8"));
const verifyOnly = process.argv.includes("--verify");
const root = mkdtempSync(join(tmpdir(), "iekei-cluster-benchmark-"));
const counters = { projections: 0, centers: 0, distances: 0 };

async function instrument(url, name) {
  let code = readFileSync(url, "utf8");
  assert.ok(code.includes("const scale =") && code.includes("const gap = Math.hypot"));
  code = code.replace("const scale =", "globalThis.clusterCounters.projections++; const scale =");
  code = code.replace(
    "const gap = Math.hypot",
    "globalThis.clusterCounters.distances++; const gap = Math.hypot",
  );
  if (code.includes("return { lat: average")) {
    code = code.replace(
      "return { lat: average",
      "globalThis.clusterCounters.centers++; return { lat: average",
    );
  } else {
    assert.ok(code.includes("let latSum = 0;") && code.includes("const center = project"));
    code = code.replace("let latSum = 0;", "globalThis.clusterCounters.centers++; let latSum = 0;");
    code = code.replace(
      "const center = project",
      "globalThis.clusterCounters.centers++; const center = project",
    );
  }
  const path = join(root, `${name}.ts`);
  writeFileSync(path, code);
  return (await import(pathToFileURL(path).href)).clusterShops;
}
function work(fn, zoom) {
  globalThis.clusterCounters = { ...counters };
  fn(shops, zoom);
  return { ...globalThis.clusterCounters };
}
function timing(fn, zoom) {
  for (let i = 0; i < 10; i++) fn(shops, zoom);
  const samples = [];
  for (let i = 0; i < 50; i++) {
    const start = performance.now();
    fn(shops, zoom);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { p50Ms: Number(samples[25].toFixed(3)), p95Ms: Number(samples[47].toFixed(3)) };
}
try {
  const before = await instrument(
    new URL("../tests/fixtures/cluster-reference.ts", import.meta.url),
    "before",
  );
  const after = await instrument(new URL("../src/lib/cluster.ts", import.meta.url), "after");
  console.info(
    JSON.stringify({
      node: process.version,
      platform: platform(),
      cpu: cpus()[0].model,
      shops: shops.length,
      warmup: 10,
      samples: 50,
      timing: !verifyOnly,
    }),
  );
  for (const zoom of [5, 10, 14, 19]) {
    assert.deepEqual(clusterShops(shops, zoom), reference(shops, zoom));
    const oldWork = work(before, zoom);
    const newWork = work(after, zoom);
    assert.ok(newWork.centers < oldWork.centers);
    assert.ok(newWork.projections <= oldWork.projections);
    assert.ok(newWork.distances <= oldWork.distances);
    if (zoom === 14 && oldWork.distances > 1024) {
      assert.ok(newWork.distances < oldWork.distances / 10);
    }
    console.info(
      JSON.stringify({
        zoom,
        before: { ...oldWork, ...(!verifyOnly && timing(reference, zoom)) },
        after: { ...newWork, ...(!verifyOnly && timing(clusterShops, zoom)) },
      }),
    );
  }
} finally {
  delete globalThis.clusterCounters;
  rmSync(root, { recursive: true, force: true });
}
