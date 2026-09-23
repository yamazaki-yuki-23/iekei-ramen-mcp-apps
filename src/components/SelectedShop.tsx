import { useEffect, useRef } from "react";
import styles from "../mcp-app.module.css";
import { OrderGuide } from "./OrderGuide";

/*
 * JSX のテキストは改行のたびに空白 1 個へ畳まれる。和文では語の途中に
 * 隙間が空いて見えるので、続く 1 文は 1 本の文字列にして持つ。
 */
const NOTE =
  "選んだ店の情報はチャットに渡してあります。「この店について聞く」を押すと、この店を話題にした質問がチャットに送られます。";

/** 上限に達したときの説明。押せない理由を必ず書く。 */
const FULL_HINT = "「まわる店」は 3 軒までです。外してから追加してください。";

interface Props {
  /** 会話に「この店について聞く」を流す。 */
  onAsk: () => void;
  /** 外部地図を開く。 */
  onOpenMap: () => void;
  onClear: () => void;
  asking: boolean;
  /** この店が「まわる店」に入っているか。 */
  inRoute: boolean;
  /** 「まわる店」が上限で、この店はまだ入っていない。 */
  routeFull: boolean;
  /** 「まわる店」に足す／外す。 */
  onToggleRoute: () => void;
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
export function SelectedShop({
  onAsk,
  onOpenMap,
  onClear,
  asking,
  inRoute,
  routeFull,
  onToggleRoute,
}: Props) {
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
        <button
          type="button"
          className={styles.buttonSecondary}
          onClick={onToggleRoute}
          disabled={routeFull}
          title={routeFull ? FULL_HINT : undefined}
        >
          {inRoute ? "まわる店から外す" : "まわる店に追加"}
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={onOpenMap}>
          地図で開く
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={onClear}>
          選択を解除
        </button>
      </div>

      {/* 押せない理由は画面に出す。title だけだとタッチ端末で読めない。 */}
      {routeFull && <p className={styles.selectedNote}>{FULL_HINT}</p>}

      <OrderGuide />

      <p className={styles.selectedNote}>{NOTE}</p>
    </section>
  );
}
