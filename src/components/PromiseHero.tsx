import type { SearchMode } from "../lib/types";
import styles from "../mcp-app.module.css";

/*
 * 和文は 1 文を 1 本の文字列にする（JSX の改行は空白 1 個に畳まれる）。
 * 約束の一言は #50 で決めたもの。言い換えない。
 */
const LEAD = "地図に家系を並べました。迷ったら、3 軒まで絞ります。";
const CAVEAT = "家系の判定と味の傾向は推定、距離は直線距離です。";

/** 舞台の下の見出し。入口を押したら、ここまで送る。 */
export const APP_HEAD_ID = "app-head";

interface Props {
  /** 入口から、その画面へ切り替える。接続前は無いので、ボタンは押せない形で出す。 */
  go?: (mode: SearchMode) => void;
}

/**
 * Web の最初の画面（#125）。開いて 3 秒で約束が伝わるように、醤油の黒の舞台に
 * 一言を屋号の太さで置き、すぐ下の地図と「迷ったら」への入口を並べる。
 *
 * **位置は求めない。** 開いた瞬間に許可を求めると、何のサイトか分かる前に断られる。
 * 地図は位置が無くても全国の店を出すので、それをそのまま見せる。
 */
export function PromiseHero({ go }: Props) {
  // 切り替えたら、その画面（見出しから下）を見せる。舞台の下に隠れたままにしない。
  const open = (mode: SearchMode) => {
    if (!go) return;
    go(mode);
    /*
     * 切り替えの描き直しが済んでから送る。先に送ると、地図が消えるなどで高さが
     * 変わったあとに位置がずれ、見出しが上端に貼り付くことがあった（10 回中 2 回）。
     */
    requestAnimationFrame(() =>
      document.getElementById(APP_HEAD_ID)?.scrollIntoView({ block: "start" }),
    );
  };
  return (
    <section className={styles.hero} aria-labelledby="promise">
      {/* 海苔 3 枚は「迷ったら 3 軒」。飾りなので読み上げない。 */}
      <span className={styles.heroNori} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <p className={styles.heroCatch} id="promise">
        近くに、
        <br />
        <em>まだ知らない</em>
        <br />
        家系がある。
      </p>
      <p className={styles.heroLead}>{LEAD}</p>
      <div className={styles.heroActions}>
        <button type="button" className={styles.button} onClick={() => open("map")} disabled={!go}>
          地図で見る
        </button>
        <button
          type="button"
          className={styles.heroSecondary}
          onClick={() => open("decide")}
          disabled={!go}
        >
          迷ったら 3 軒に絞る
        </button>
      </div>
      <p className={styles.heroCaveat}>{CAVEAT}</p>
    </section>
  );
}
