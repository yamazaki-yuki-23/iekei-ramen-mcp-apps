import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { reportListQuery, reportPage } from "./report-pages.mjs";

// 公開HTTPの読み取り口は作らず、Wranglerの認証済みD1操作だけを使う。
const [action, ...ids] = process.argv.slice(2);
let sql;
if (action === "list" && ids.length <= 1) {
  try {
    sql = reportListQuery(ids[0]);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else if (
  action === "delete" &&
  ids.length > 0 &&
  ids.every((id) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id))
) {
  // IDの形式を固定してからSQLに入れる。自由記述をSQLへ補間しない。
  sql = `DELETE FROM reports WHERE id IN (${ids.map((id) => `'${id}'`).join(",")}) RETURNING id`;
} else {
  console.error(
    "使い方: npm run reports -- list [nextCursor] | npm run reports -- delete <処理済み報告ID...>",
  );
  process.exit(1);
}
try {
  const output = execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)),
      "d1",
      "execute",
      "iekei-ramen-visits",
      "--remote",
      "--json",
      "--command",
      sql,
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const results = JSON.parse(output);
  if (!Array.isArray(results) || results.some((result) => result.success !== true))
    throw new Error("D1操作が成功していません");
  console.log(
    JSON.stringify(
      action === "list"
        ? reportPage(results.flatMap((result) => result.results))
        : results.flatMap((result) => result.results),
      null,
      2,
    ),
  );
} catch {
  console.error(
    "D1操作に失敗しました。WranglerのログインまたはD1権限のあるAPIトークンを確認してください。秘密の値は共有しないでください。",
  );
  process.exit(1);
}
