/**
 * E2E 用の検証ホスト（MCP Apps SDK の basic-host）を用意する。
 *
 * 実ホストと同じプロトコルで動かしたいので、リファレンス実装をそのまま使う。
 * project の lockfile と同じ版を使い、checkout と成果物を毎回検証する。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ドット始まりのディレクトリに置くと express の sendFile が dotfile 扱いで
// 拒否するため、e2e-host/ という通常のディレクトリ名にしている。
const ROOT = path.join(import.meta.dirname, "..");
const REPO_DIR = path.join(ROOT, "e2e-host", "ext-apps");
const STATE_FILE = path.join(ROOT, "e2e-host", "setup-state.json");
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
const version = lock.packages?.["node_modules/@modelcontextprotocol/ext-apps"]?.version;
if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
  throw new Error("package-lock.json に ext-apps の固定版がありません");
}
if (process.argv.includes("--version")) {
  console.log(version);
  process.exit(0);
}
const tag = `v${version}`;

const HOST_DIR = path.join(REPO_DIR, "examples", "basic-host");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const git = (args) =>
  execFileSync("git", args, { cwd: REPO_DIR, encoding: "utf8", stdio: "pipe" }).trim();
const digest = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

if (!fs.existsSync(REPO_DIR)) {
  console.error("basic-host を取得中…");
  run("git", [
    "clone",
    "--branch",
    tag,
    "--depth",
    "1",
    "https://github.com/modelcontextprotocol/ext-apps.git",
    REPO_DIR,
  ]);
}

if (git(["status", "--porcelain", "--untracked-files=no"])) {
  throw new Error(`${REPO_DIR} に未コミットの変更があります。変更を保存してから再実行してください`);
}
let commit;
try {
  commit = git(["rev-parse", "--verify", `refs/tags/${tag}^{commit}`]);
} catch {
  run("git", ["fetch", "--depth", "1", "origin", `refs/tags/${tag}:refs/tags/${tag}`], REPO_DIR);
  commit = git(["rev-parse", "--verify", `refs/tags/${tag}^{commit}`]);
}
if (git(["rev-parse", "HEAD"]) !== commit) {
  run("git", ["checkout", "--detach", tag], REPO_DIR);
}
if (JSON.parse(fs.readFileSync(path.join(HOST_DIR, "package.json"), "utf8")).version !== version) {
  throw new Error(`${HOST_DIR} の版が ${version} と一致しません`);
}

// foreign repo の外に置き、手元の tracked ファイルは変更しない。
const fingerprint = createHash("sha256")
  .update(
    JSON.stringify({
      version,
      commit,
      node: process.versions.node.split(".")[0],
      lock: digest(path.join(REPO_DIR, "package-lock.json")),
      setup: digest(import.meta.filename),
    }),
  )
  .digest("hex");
let state;
try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
} catch {
  // 初回・古いキャッシュ・壊れた状態ファイルは再構築する。
}
const install =
  state?.fingerprint !== fingerprint || !fs.existsSync(path.join(HOST_DIR, "node_modules"));
if (install) {
  console.error("basic-host の依存をインストール中…");
  run("npm", ["ci", "--no-audit", "--no-fund"], HOST_DIR);
}

const artifacts = ["index.html", "sandbox.html"];
const artifactHashes = () =>
  Object.fromEntries(artifacts.map((file) => [file, digest(path.join(HOST_DIR, "dist", file))]));
let validArtifacts = false;
try {
  validArtifacts = artifacts.every(
    (file) => state?.artifacts?.[file] === digest(path.join(HOST_DIR, "dist", file)),
  );
} catch {
  // 成果物が欠けていれば再ビルドする。
}
// bun を前提にしない形でビルドしておく（起動は tsx で行う）。
if (install || !validArtifacts) {
  console.error("basic-host をビルド中…");
  run("npm", ["run", "build"], HOST_DIR);
}

fs.writeFileSync(
  STATE_FILE,
  JSON.stringify({ fingerprint, version, commit, artifacts: artifactHashes() }),
);
console.error(`E2E ホスト ${tag} の準備完了`);
