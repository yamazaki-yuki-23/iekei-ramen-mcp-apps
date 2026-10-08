import { resultCaveat } from "../lib/data-caveats";
import styles from "../mcp-app.module.css";

/** 結果のすぐ下の但し書き（#152）。どのモードでも 1 画面に 1 回。 */
export function ResultCaveat({ reports }: { reports: boolean }) {
  return <p className={styles.resultCaveat}>{resultCaveat(reports)}</p>;
}
