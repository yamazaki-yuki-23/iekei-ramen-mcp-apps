import styles from "../styles/match.module.css";
import { Sheet } from "./Sheet";

/** 見終わったとき。続きの取得に失敗していたら、「全部見た」と言わずに取り直しを出す。 */
export function EndSheet({
  count,
  more,
  failed,
  onWider,
  onRetry,
  onWants,
}: {
  count: number;
  more: boolean;
  failed: boolean;
  onWider(): void;
  onRetry(): void;
  onWants(): void;
}) {
  if (failed)
    return (
      <Sheet title="続きを読み込めませんでした">
        <p>この範囲の {count} 軒は見ました。通信の状態を確かめて、もう一度読み込んでください。</p>
        <div className={styles.row}>
          <button type="button" className={styles.btnPrimary} onClick={onRetry}>
            もう一度読み込む
          </button>
          <button type="button" className={styles.btn} onClick={onWants}>
            行きたいリストを見る
          </button>
        </div>
      </Sheet>
    );
  return (
    <Sheet title={`この範囲の ${count} 軒は、全部見ました`}>
      <p>もっと遠くまで見るか、「行きたい」に入れた店から決めましょう。</p>
      <div className={styles.row}>
        <button type="button" className={styles.btnPrimary} onClick={onWider} disabled={!more}>
          範囲を広げる
        </button>
        <button type="button" className={styles.btn} onClick={onWants}>
          行きたいリストを見る
        </button>
      </div>
    </Sheet>
  );
}
