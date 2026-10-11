import { useState } from "react";
import { shareLinks } from "../lib/share";
import styles from "./camera.module.css";

const focusHeading = (el: HTMLHeadingElement | null) => el?.focus();

/**
 * 共有の画面を使わずに投稿する手順（PC、または共有の画面を開けなかった・閉じたとき）。
 * どれも利用者が押してから動かす（押した直後でないと、ブラウザが保存や新しい窓を止めることがある）。
 */
export function ManualPost({
  platform,
  file,
  text,
}: {
  platform: "x" | "threads";
  file: File;
  text: string;
}) {
  const [status, setStatus] = useState("");
  const links = shareLinks(text);
  const save = () => {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    // 保存が始まる前に片付けると、端末によっては保存できない。
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = () =>
    (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error("no clipboard"))).then(
      () => setStatus("文をコピーしました。"),
      () => setStatus("コピーできませんでした。投稿の画面には文が入っています。"),
    );
  const name = platform === "x" ? "X" : "Threads";
  return (
    <section className={styles.manual} aria-labelledby="manual-title">
      <h3 id="manual-title" tabIndex={-1} ref={focusHeading}>
        写真を添えて {name} に投稿する
      </h3>
      <ol>
        <li>
          <button type="button" className={styles.btn} onClick={save}>
            写真を保存
          </button>
        </li>
        <li>
          <button type="button" className={styles.btn} onClick={() => void copy()}>
            文をコピー
          </button>
        </li>
        <li>
          <a
            className={styles.btn}
            href={platform === "x" ? links.x : links.threads}
            target="_blank"
            rel="noopener noreferrer"
          >
            {name} の投稿画面を開く
          </a>
          （保存した写真を添えてください）
        </li>
      </ol>
      {status && <p role="status">{status}</p>}
    </section>
  );
}
