/**
 * React Doctor の設定。
 *
 * ルールを切るのは最後の手段で、まずコードを直す。ここで外しているのは
 * 「自分たちが書いていないファイル」だけ。
 */
export default {
  ignore: {
    files: [
      // MCP Apps SDK の basic-host を取得しただけのもの（E2E 用、gitignore 済み）。
      "e2e-host/**",
      // ビルド生成物。dist は vite、src/generated は embed-html.mjs が作る。
      "dist/**",
      "src/generated/**",
      // スクリーンショットや撮影結果。
      "shots/**",
      "test-results/**",
      "test-results-shoot/**",
    ],
  },
  // CI のゲートと揃える。手元でも同じ基準で落ちる方が、CI で初めて気付くより早い。
  blocking: "warning",
} as const;
