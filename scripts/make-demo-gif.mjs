/**
 * capture.spec.ts が録った webm を README 用の GIF に変換する。
 *
 * GitHub は README の動画タグを許さないので GIF にする。
 * パレットを 2 パスで作ると、地図タイルのような階調のある画面でも
 * 色崩れが目立たない。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const resultsDir = path.join(root, "test-results");
const out = path.join(root, "docs", "demo.gif");

/** 「デモ」テストが残した webm を探す。 */
function findDemoVideo(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findDemoVideo(full);
      if (hit) return hit;
    } else if (entry.name.endsWith(".webm") && dir.includes("デモ")) {
      return full;
    }
  }
  return null;
}

const video = findDemoVideo(resultsDir);
if (!video) throw new Error("デモ動画が見つかりません。先に npm run capture を実行してください。");

const palette = path.join(root, "test-results", "palette.png");
// README で読み込ませるので、見やすさを保ちつつ数 MB に収まる設定にする。
const filters = "fps=6,scale=640:-1:flags=lanczos";

execFileSync(
  "ffmpeg",
  ["-y", "-i", video, "-vf", `${filters},palettegen=stats_mode=diff`, palette],
  { stdio: "inherit" },
);

execFileSync(
  "ffmpeg",
  [
    "-y",
    "-i",
    video,
    "-i",
    palette,
    "-lavfi",
    `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
    out,
  ],
  { stdio: "inherit" },
);

const size = fs.statSync(out).size / 1024 / 1024;
console.error(`GIF を生成: ${path.relative(root, out)} (${size.toFixed(1)} MB)`);
if (size > 10) {
  console.error("警告: 10 MB を超えています。GitHub の表示が重くなります。");
}
