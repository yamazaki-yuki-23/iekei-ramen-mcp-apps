/**
 * 置き場の「使う範囲」の決まり（docs/development/structure.md）を、import をたどって確かめる。
 *
 * - 1 つの機能だけが使うものは `src/features/<機能>/`、2 つ以上が使うものは `src/` のトップ
 * - 使う側は、機能（`features/<機能>`）・`server/`・`scripts/` を 1 つずつ数える
 * - トップのファイルは、トップのほかのファイルを経由した使い手も数える
 *
 * import の向き（機能どうし・共有から機能など）は lint（.oxlintrc.json）が見張る。ここは lint で
 * 書けない「何か所から使われているか」だけを見る。テスト（tests/・e2e/）は使い手に数えない。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SHARED = ["components", "hooks", "lib", "utils", "types"];

function walk(dir: string): string[] {
  if (!existsSync(join(ROOT, dir))) return [];
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
  });
}

/**
 * ほかのコードを測るだけの道具（scripts/dev/benchmark-*.mjs）は、テストと同じく使う側に数えない。
 * 製品の一部ではなく、測る相手の置き場を動かす理由にならないため。
 */
const MEASURE_ONLY = /^scripts\/dev\/benchmark-[^/]+\.mjs$/;
const sources = [...walk("src"), ...walk("server"), ...walk("scripts")].filter(
  (path) =>
    /\.(ts|tsx|mjs)$/.test(path) &&
    !path.startsWith("src/generated/") &&
    !MEASURE_ONLY.test(path) &&
    !path.endsWith(".test.ts"),
);

/** そのファイルが相対で import しているファイル（拡張子を補って解決する）。 */
function importsOf(file: string): string[] {
  const text = readFileSync(join(ROOT, file), "utf8");
  const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)].map(
    (match) => match[1],
  );
  return specs.flatMap((spec) => {
    const base = normalize(join(dirname(file), spec));
    const found = ["", ".ts", ".tsx", ".mjs", "/index.ts", "/index.tsx"]
      .map((ext) => base + ext)
      .find((path) => existsSync(join(ROOT, path)) && statSync(join(ROOT, path)).isFile());
    return found ? [found] : [];
  });
}

/** 使う側の単位。トップの共有のファイルは単位を持たない（その先の使い手を数える）。 */
function unitOf(file: string): string | null {
  const feature = /^src\/features\/([^/]+)\//.exec(file);
  if (feature) return `features/${feature[1]}`;
  if (file.startsWith("server/")) return "server/";
  if (file.startsWith("scripts/")) return "scripts/";
  return null;
}

const importers = new Map<string, string[]>();
for (const file of sources) {
  for (const target of importsOf(file)) {
    importers.set(target, [...(importers.get(target) ?? []), file]);
  }
}

/** トップのファイルを使う単位。トップのほかのファイルを経由した使い手もたどる。 */
function unitsUsing(file: string, seen = new Set<string>()): Set<string> {
  const units = new Set<string>();
  for (const from of importers.get(file) ?? []) {
    const unit = unitOf(from);
    if (unit) units.add(unit);
    else if (!seen.has(from)) {
      seen.add(from);
      for (const u of unitsUsing(from, seen)) units.add(u);
    }
  }
  return units;
}

const sharedFiles = sources.filter((path) => SHARED.some((dir) => path.startsWith(`src/${dir}/`)));
/** 単位の中のファイル（機能・server/・scripts/）。自分の単位からだけ使われる。 */
const unitFiles = sources.filter((path) => unitOf(path) !== null);

describe("使う範囲の決まり（docs/development/structure.md）", () => {
  it("src/ のトップのファイルは、2 つ以上の単位（機能・server/・scripts/）から使われている（0 や 1 は落とす）", () => {
    const narrow = sharedFiles
      .map((file) => ({ file, units: [...unitsUsing(file)] }))
      .filter(({ units }) => units.length < 2)
      .map(({ file, units }) =>
        units.length === 0
          ? `${file} は製品のどこからも使われていない（テストだけ） → 使う所の中へ入れるか消す`
          : `${file} は ${units[0]} だけが使う → ${units[0]} の中へ`,
      );
    expect(narrow).toEqual([]);
  });

  it("機能・server/・scripts/ の中のファイルは、その単位の中からだけ使われている", () => {
    const leaks = unitFiles.flatMap((file) => {
      const own = unitOf(file);
      return (importers.get(file) ?? [])
        .filter((from) => unitOf(from) !== own)
        .map((from) => `${relative(ROOT, join(ROOT, from))} が ${file} を使う → src/ のトップへ`);
    });
    expect(leaks).toEqual([]);
  });

  it("調べる対象が見つかっている（たどり方が壊れていない）", () => {
    expect(sharedFiles.length).toBeGreaterThan(20);
    expect(unitFiles.filter((file) => file.startsWith("src/features/")).length).toBeGreaterThan(50);
    expect(unitsUsing("src/types/index.ts").size).toBeGreaterThanOrEqual(3);
  });
});
