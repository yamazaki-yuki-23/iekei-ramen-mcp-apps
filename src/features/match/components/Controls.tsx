import { DATA_CREDIT } from "../../../utils/data-caveats";
import type { SwipeDir } from "../../../types";
import styles from "../styles/match.module.css";

/** 操作キー（払えない人も同じことができる）と、但し書き・出典。 */
export function Controls({
  canSwipe,
  canUndo,
  onFly,
  onUndo,
  onToday,
}: {
  canSwipe: boolean;
  canUndo: boolean;
  onFly(dir: SwipeDir): void;
  onUndo(): void;
  onToday(): void;
}) {
  return (
    <>
      <div className={styles.keys}>
        <button
          type="button"
          className={styles.key}
          onClick={() => onFly("pass")}
          disabled={!canSwipe}
        >
          ← パス<small>左に払う</small>
        </button>
        <button type="button" className={styles.key} onClick={onUndo} disabled={!canUndo}>
          戻す<small>1 枚</small>
        </button>
        <button
          type="button"
          className={styles.keyWant}
          onClick={() => onFly("want")}
          disabled={!canSwipe}
        >
          行きたい →<small>右に払う</small>
        </button>
      </div>
      {/* キーの添え書きは、キーボードのある端末だけ（#255。指で触れる端末に「Enter」は無い）。 */}
      <button
        type="button"
        className={styles.today}
        onClick={onToday}
        disabled={!canSwipe}
        aria-keyshortcuts="Enter"
      >
        この店に決める<span className={styles.keyHint}>（Enter）</span>
      </button>
      <p className={styles.caveat}>
        家系かどうかは推定、味の傾向は参考値で、並び順は近い順（おすすめ度ではありません）。距離は直線距離です。違う店があれば、
        <a href="/">トップ</a>で店を開き「店舗情報を報告する」から教えてください。
      </p>
      <p className={styles.credit}>{DATA_CREDIT}</p>
    </>
  );
}
