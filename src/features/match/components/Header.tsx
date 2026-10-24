import { useState } from "react";
import { BrandMark } from "../../../components/BrandMark";
import { isMuted, setMuted } from "../../../lib/sound";
import styles from "../styles/match.module.css";

export function Header({
  place,
  wants,
  onWants,
}: {
  place: string;
  wants: number;
  onWants(): void;
}) {
  const [muted, setMutedState] = useState(isMuted);
  return (
    <div className={styles.top}>
      {/* 左上はどのページでも同じ「丼＋家系ラーメンを探す」で、押すとトップへ（#182）。 */}
      <div className={styles.brandRow}>
        <a className={styles.brand} href="/">
          <BrandMark size={36} />
          家系ラーメンを探す
        </a>
      </div>
      <div className={styles.head}>
        <h1 className={styles.pageTitle}>家系マッチ</h1>
        {place && <span className={styles.place}>{place}</span>}
      </div>
      <div className={styles.headRight}>
        <button
          type="button"
          className={styles.round}
          aria-pressed={muted}
          aria-label={muted ? "音を出す" : "音を消す"}
          onClick={() => {
            setMuted(!muted);
            setMutedState(!muted);
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
            <path className={styles.wave} d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
            <path className={styles.slash} d="M16 9l6 6M22 9l-6 6" />
          </svg>
        </button>
        <button type="button" className={styles.round} onClick={onWants}>
          行きたいリスト <b>{wants}</b>
        </button>
      </div>
    </div>
  );
}
