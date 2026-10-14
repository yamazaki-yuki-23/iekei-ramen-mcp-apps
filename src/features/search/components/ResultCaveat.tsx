import { resultCaveat } from "../../../utils/data-caveats";
import styles from "../styles/search.module.css";

/** 結果のすぐ下の但し書き（#152）。どのモードでも 1 画面に 1 回。 */
export function ResultCaveat({ reports }: { reports: boolean }) {
  return <p className={styles.resultCaveat}>{resultCaveat(reports)}</p>;
}
