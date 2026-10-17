/**
 * 種類のフォルダの中身の決まり（docs/development/structure.md の「強制のしかた」の置き場の表）。
 * `utils/` が外部に触らないことは lint（.oxlintrc.json）が見張る。ここは逆向きの「`lib/` は外部に
 * 触る」と、`types/`・`components/`・`styles/`・`generated/` の中身を見る。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { transformWithOxc } from "vite";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

function walk(dir: string): string[] {
  if (!existsSync(join(ROOT, dir))) return [];
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
  });
}
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
/** 種類のフォルダ（src/ のトップ・各機能・server/）の中のファイル。 */
const inKind = (kind: string) =>
  [...walk("src"), ...walk("server")].filter(
    (path) =>
      new RegExp(`^(src/(features/[^/]+/)?|server/)${kind}/`).test(path) &&
      !path.endsWith(".test.ts"),
  );

/**
 * 外部に触るときに使うグローバル。`utils/` で禁じるもの（.oxlintrc.json の no-restricted-globals）と
 * 同じものに、描画の API を足したもの。
 */
const EXTERNAL_GLOBALS = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "fetch",
  "location",
  "history",
  "AudioContext",
  "matchMedia",
  "requestAnimationFrame",
  "requestIdleCallback",
  "setTimeout",
  "setInterval",
  "indexedDB",
  "crypto",
  "createImageBitmap",
  "OffscreenCanvas",
  "CanvasRenderingContext2D",
  // Cloudflare のサービスにつなぐ binding（引数で受け取って使う）
  "D1Database",
  "KVNamespace",
  "AnalyticsEngineDataset",
  "DurableObjectState",
  "DurableObjectNamespace",
  "R2Bucket",
];

/** 値として import している先（`import type` は数えない）。 */
const valueImports = (text: string) =>
  [...text.matchAll(/^import\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gms)].map((m) => m[1]);

/** ビルドと同じ Vite の oxc で JavaScript にしたとき、何も残らないか（型だけのファイルか）。 */
async function typeOnly(file: string): Promise<boolean> {
  const { code } = await transformWithOxc(read(file), file, {
    lang: "ts",
    typescript: { onlyRemoveTypeImports: true },
  });
  // 型だけのモジュールでも残る印（export {};）と空の文（;）は数えない
  return !code
    .replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")
    .replace(/export\s*\{\s*\};?/g, "")
    .replace(/^\s*;\s*$/gm, "")
    .trim();
}

describe("種類のフォルダの中身（docs/development/structure.md）", () => {
  it("types/ には型だけがある（JavaScript にすると何も残らない）", async () => {
    // 値の宣言・値の import・再 export・式のどれでも、型でないものは JavaScript に残る
    const bad: string[] = [];
    for (const file of inKind("types")) if (!(await typeOnly(file))) bad.push(file);
    expect(bad).toEqual([]);
  });

  it("型だけのファイルは types/ に置く（utils/・lib/ に置かない）", async () => {
    const bad: string[] = [];
    for (const file of [...inKind("utils"), ...inKind("lib")].filter((f) => f.endsWith(".ts")))
      if (await typeOnly(file)) bad.push(`${file}: 型だけ → types/ へ`);
    expect(bad).toEqual([]);
  });

  it("lib/ のファイルは外部に触る（決めたグローバル・Cloudflare の binding・外部のパッケージ・ほかの lib/ の値のどれかを使う）", () => {
    const bad = inKind("lib")
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) => {
        const text = read(file);
        const global = EXTERNAL_GLOBALS.some((name) => new RegExp(`\\b${name}\\b`).test(text));
        const imports = valueImports(text);
        const pkg = imports.some((spec) => !spec.startsWith("."));
        const lib = imports.some(
          (spec) => /(^|\/)lib\//.test(spec) || (spec.startsWith("./") && !spec.includes("/../")),
        );
        return !global && !pkg && !lib;
      })
      .map((file) => `${file}: 外部に触っていない → utils/ へ`);
    expect(bad).toEqual([]);
  });

  it("components/ には React の部品（.tsx）と部品専用の CSS（.module.css）だけがある", () => {
    const bad = inKind("components").filter((file) => !/\.(tsx|module\.css)$/.test(file));
    expect(bad).toEqual([]);
  });

  it("styles/ には CSS だけがある", () => {
    const bad = inKind("styles").filter((file) => !file.endsWith(".css"));
    expect(bad).toEqual([]);
  });

  it("generated/ はビルドが作るものだけで、Git に入れていない", () => {
    const tracked = execFileSync("git", ["ls-files", "src/generated"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(tracked.trim()).toBe("");
  });

  it("調べる対象が見つかっている（たどり方が壊れていない）", () => {
    expect(inKind("lib").length).toBeGreaterThan(5);
    expect(inKind("types").map((file) => basename(file))).toContain("index.ts");
  });
});
