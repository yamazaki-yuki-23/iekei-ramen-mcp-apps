import { ORDER_SETS, PREFERENCES, SIDE_TIPS } from "../lib/order-guide";
import styles from "../mcp-app.module.css";

/* 和文は 1 文を 1 本の文字列にする（JSX の改行は空白 1 個になる）。 */
const DISCLAIMER =
  "ここに書いたのは家系で一般的とされる作法です。店ごとの決まりは持っていないので、実際の呼び方や有無はお店の掲示に従ってください。";

/**
 * 注文のカンペ。
 *
 * 店を探すより、券売機の前と「お好みは？」で止まる人の方が多い。ここだけは
 * データが無くても助けられるので、選択中の店の下に畳んで置いている。
 * 中身は一般的な作法で、店ごとの流儀ではない（データを持っていない）。
 */
export function OrderGuide() {
  return (
    <details className={styles.guide}>
      <summary className={styles.guideSummary}>注文のしかた（お好み・卓上・ライス）</summary>

      <div className={styles.guideBody}>
        <table className={styles.guideTable}>
          <thead>
            <tr>
              <th scope="col">聞かれること</th>
              <th scope="col">答え方</th>
            </tr>
          </thead>
          <tbody>
            {PREFERENCES.map(({ key, label, options, note }) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td>
                  <span className={styles.guideOptions}>{options.join(" / ")}</span>
                  <span className={styles.meta}>{note}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <ul className={styles.guideSets}>
          {ORDER_SETS.map(({ label, choice, why }) => (
            <li key={label}>
              <span className={styles.badge}>{label}</span>
              <span className={styles.guideChoice}>{choice.join(" / ")}</span>
              <span className={styles.meta}>{why}</span>
            </li>
          ))}
        </ul>

        <ul className={styles.guideTips}>
          {SIDE_TIPS.map((tip) => (
            <li key={tip} className={styles.meta}>
              {tip}
            </li>
          ))}
        </ul>

        <p className={styles.selectedNote}>{DISCLAIMER}</p>
      </div>
    </details>
  );
}
