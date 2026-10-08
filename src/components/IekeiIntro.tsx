import { useEffect } from "react";
import { OrderGuide } from "./OrderGuide";
import { markIntroSeen } from "../lib/intro-state";
import styles from "../mcp-app.module.css";

interface Props {
  open: boolean;
  onToggle: (open: boolean) => void;
}

/** 開閉状態はWebの入口が持ち、検索結果の入れ替えでも畳まない。 */
export function IekeiIntro({ open, onToggle }: Props) {
  useEffect(markIntroSeen, []);

  return (
    <details
      className={styles.guide}
      aria-label="家系とは"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary className={styles.guideSummary}>家系とは</summary>
      <div className={styles.guideBody}>
        <div className={styles.introLines}>
          <p>豚骨醤油と太めの麺が定番です。</p>
          <p>迷ったら、まず3軒から見てみよう。</p>
        </div>
        <details className={styles.guide}>
          <summary className={styles.guideSummary}>直系・資本系・インスパイア系とは</summary>
          <dl className={styles.introTerms}>
            <dt>直系</dt>
            <dd>吉村家が直系として認めた店。</dd>
            <dt>資本系</dt>
            <dd>企業が展開する家系チェーンなどを指す呼び方。</dd>
            <dt>インスパイア系</dt>
            <dd>家系のスタイルを参考にした店を指す呼び方。</dd>
          </dl>
        </details>
        <OrderGuide />
      </div>
    </details>
  );
}
