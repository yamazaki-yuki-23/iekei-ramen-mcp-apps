import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("中心の再計算と高ズームの距離判定は変更前より少ない", () => {
  // CPUの速さで成否を変えない。既存実装との完全一致と、計算・探索の回数だけを判定する。
  const result = execFileSync(process.execPath, ["scripts/benchmark-clusters.mjs", "--verify"], {
    encoding: "utf8",
    timeout: 20_000,
  });
  const rows = result
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(rows.slice(1).map((row) => row.zoom)).toEqual([5, 10, 14, 19]);
});
