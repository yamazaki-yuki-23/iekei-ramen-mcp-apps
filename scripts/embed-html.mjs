/**
 * vite が出力した dist/mcp-app.html を TypeScript の文字列としてバンドルし直す。
 *
 * Cloudflare Workers にはファイルシステムが無いため、リソースの HTML は
 * コードに埋め込む必要がある。JSON.stringify でエスケープするので
 * バッククォートや ${} を含む HTML でも壊れない。
 */
import fs from "node:fs/promises";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const html = await fs.readFile(path.join(root, "dist", "mcp-app.html"), "utf-8");
const out = path.join(root, "src", "generated", "app-html.ts");

await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(
  out,
  `// 自動生成ファイル。編集しないこと（scripts/embed-html.mjs が生成する）。\nexport const APP_HTML = ${JSON.stringify(html)};\n`,
);

console.error(`embedded ${(html.length / 1024).toFixed(0)} KB -> ${path.relative(root, out)}`);
