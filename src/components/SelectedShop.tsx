import { useEffect, useRef } from "react";
import styles from "../mcp-app.module.css";
import { OrderGuide } from "./OrderGuide";

interface Props {
  /** 会話に「この店について聞く」を流す。 */
  onAsk: () => void;
  /** 外部地図を開く。 */
  onOpenMap: () => void;
  onClear: () => void;
  asking: boolean;
}

/**
 * 選択中の店に対する操作。選んだカードの中に続けて描く。
 *
 * 店名・住所・バッジはカードが既に出しているので、ここでは繰り返さない。
 * 同じ情報を 2 度見せると、枠が 2 つあるように見えて読みにくい。
 *
 * カードを押すと即座に外部地図が開いていた頃は、選択という状態が残らず
 * モデルに渡すものが無かった。カードは選ぶだけにして、行き先はここに出す。
 */
export function SelectedShop({ onAsk, onOpenMap, onClear, asking }: Props) {
  // 一覧は高さを制限してスクロールさせているので、下の方のカードを選ぶと
  // 詳細が見切れる。選んだ直後だけ、はみ出した分を寄せる。
  // 別の店を選ぶとカードごと作り直される（li の key が店の id）ので、
  // マウント時に 1 度でいい。
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <section className={styles.selected} aria-label="選択中の店舗" ref={ref}>
      <div className={styles.selectedActions}>
        <button type="button" className={styles.button} onClick={onAsk} disabled={asking}>
          {asking ? "送信中…" : "この店について聞く"}
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={onOpenMap}>
          地図で開く
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={onClear}>
          選択を解除
        </button>
      </div>

      <OrderGuide />

      <p className={styles.selectedNote}>
        選んだ店の情報はチャットに渡してあります。「この店について聞く」を押すと、この店を
        話題にした質問がチャットに送られます。
      </p>
    </section>
  );
}
