/*
 * 確認用の環境（staging、#192）へ、いまの作業ツリーを上げる。どのブランチからでも使える。
 *
 *   npm run deploy:staging
 *
 * 1. Web と MCP の画面をビルドする（本番と同じ）
 * 2. dist/web を dist/staging に写し、検索エンジンに載せない robots.txt と X-Robots-Tag を足す
 *    （Access で守られているが、念のため）
 * 3. 確認用の D1 に migrations/ を当て、wrangler deploy --env staging
 */
import { execSync } from "node:child_process";
import { appendFileSync, cpSync, rmSync, writeFileSync } from "node:fs";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

run("npm run build:ui");
rmSync("dist/staging", { recursive: true, force: true });
cpSync("dist/web", "dist/staging", { recursive: true });
writeFileSync("dist/staging/robots.txt", "User-agent: *\nDisallow: /\n");
appendFileSync(
  "dist/staging/_headers",
  "\n# 確認用（#192）は検索エンジンに載せない。\n/*\n  X-Robots-Tag: noindex\n",
);
run("npx wrangler d1 migrations apply iekei-ramen-visits-staging --env staging --remote");
run("npx wrangler deploy --env staging");
