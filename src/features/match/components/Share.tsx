import { shareLinks } from "../../../utils/share";
import { shareText } from "../utils/swipe";
import styles from "../styles/match.module.css";

const SITE = "https://iekeiramen.com/match/";

/**
 * 決まった店のシェア（文字だけ）。投稿画面の URL は src/utils/share.ts（#46 と共有）。
 * 文は決めた事実と場所だけで、店の評価は書かない。
 */
export function Share({ names }: { names: string[] }) {
  const { threads, x } = shareLinks(shareText(names), SITE);
  return (
    <div className={styles.row}>
      <a className={styles.btn} href={x} target="_blank" rel="noopener noreferrer">
        X でシェア
      </a>
      <a className={styles.btn} href={threads} target="_blank" rel="noopener noreferrer">
        Threads でシェア
      </a>
    </div>
  );
}
