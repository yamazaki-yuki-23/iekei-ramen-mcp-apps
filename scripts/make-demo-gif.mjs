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

// 冒頭はホストの読み込み中が映るので飛ばす。GIF の 1 コマ目が
// そのまま静止画として見えるため、アプリが出た状態から始める。
// -ss での seek は webm のキーフレーム間隔に引きずられて効かないので、
// フィルタの trim で確実に落とす。
const SKIP_HEAD_SEC = 3.5;

const palette = path.join(root, "test-results", "palette.png");
// README で読み込ませるので、見やすさを保ちつつ数 MB に収まる設定にする。
/*
 * README に貼るので、読み込みの軽さを優先する。操作の流れが分かれば十分なので
 * 5fps・幅 720px に落としてある（4 モードぶんに伸ばしたとき 3.6MB まで膨らみ、
 * GitHub 上で表示が重くなった）。
 */
const filters = `trim=start=${SKIP_HEAD_SEC},setpts=PTS-STARTPTS,fps=5,scale=720:-1:flags=lanczos`;

execFileSync(
  "ffmpeg",
  ["-y", "-i", video, "-vf", `${filters},palettegen=stats_mode=full:max_colors=128`, palette],
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
    `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
    out,
  ],
  { stdio: "inherit" },
);

const size = fs.statSync(out).size / 1024 / 1024;
console.error(`GIF を生成: ${path.relative(root, out)} (${size.toFixed(1)} MB)`);
if (size > 10) {
  console.error("警告: 10 MB を超えています。GitHub の表示が重くなります。");
}
