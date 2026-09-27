import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * CSS 変数の書き間違いを丸ごと捕まえる。
 *
 * **無い名前を使っても、CSS は黙って宣言ごと捨てる。** 画面は「効かなかった」
 * 見た目で出るだけなので、目視でも気付きにくい（実際に `--color-text-secondary`
 * という存在しない名前で注記を書いており、ふつうの本文色のまま出ていた）。
 */
const GLOBAL = readFileSync(new URL("../src/global.css", import.meta.url), "utf8");
const MODULE = readFileSync(new URL("../src/mcp-app.module.css", import.meta.url), "utf8");

/** 実行時に JS から差し込む変数。CSS には定義が無くてよい。 */
const FROM_RUNTIME = /^--safe-area-/;

function definedNames(css: string): Set<string> {
  return new Set([...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
}

function usedNames(css: string): Set<string> {
  return new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
}

describe("CSS の変数", () => {
  it("使っている名前はすべて定義されている", () => {
    const defined = new Set([...definedNames(GLOBAL), ...definedNames(MODULE)]);
    const missing = [...usedNames(MODULE), ...usedNames(GLOBAL)]
      .filter((name) => !defined.has(name))
      .filter((name) => !FROM_RUNTIME.test(name));

    expect(missing).toEqual([]);
  });
});
