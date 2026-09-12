/**
 * E2E 用の検証ホスト（MCP Apps SDK の basic-host）を用意する。
 *
 * 実ホストと同じプロトコルで動かしたいので、リファレンス実装をそのまま使う。
 * 取得済みなら何もしないので、毎回の E2E 実行で走らせてよい。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ドット始まりのディレクトリに置くと express の sendFile が dotfile 扱いで
// 拒否するため、e2e-host/ という通常のディレクトリ名にしている。
const REPO_DIR = path.join(import.meta.dirname, "..", "e2e-host", "ext-apps");

const HOST_DIR = path.join(REPO_DIR, "examples", "basic-host");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

if (!fs.existsSync(REPO_DIR)) {
  console.error("basic-host を取得中…");
  const version = execFileSync("npm", ["view", "@modelcontextprotocol/ext-apps", "version"])
    .toString()
    .trim();
  run("git", [
    "clone",
    "--branch",
    `v${version}`,
    "--depth",
    "1",
    "https://github.com/modelcontextprotocol/ext-apps.git",
    REPO_DIR,
  ]);
}

if (!fs.existsSync(path.join(HOST_DIR, "node_modules"))) {
  console.error("basic-host の依存をインストール中…");
  run("npm", ["install", "--no-audit", "--no-fund"], HOST_DIR);
}

// bun を前提にしない形でビルドしておく（起動は tsx で行う）。
if (!fs.existsSync(path.join(HOST_DIR, "dist", "sandbox.html"))) {
  console.error("basic-host をビルド中…");
  run("npm", ["run", "build"], HOST_DIR);
}

console.error("E2E ホストの準備完了");
