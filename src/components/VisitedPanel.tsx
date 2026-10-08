import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { VisitSummary } from "../lib/progress";
import { visitedView } from "../lib/visited-view";
import type { Shop } from "../lib/types";
import styles from "../mcp-app.module.css";
import { ShopList } from "./ShopList";

/* 和文は 1 文を 1 本の文字列にする（JSX の改行は空白 1 個に畳まれる）。 */
const SIGN_IN_NOTE =
  "行った店の記録は、サインインした人ごとに保存します。端末やホストが変わっても同じ記録が見えます。";
const SIGN_IN_WHY =
  "この画面から直接サインインはできないため、チャットに依頼を送ります。ホストがサインインの案内を出します。";
const FORGET_WARN = "記録をすべて削除します。元に戻せません。";

interface Props {
  /** サインインしているか。匿名なら記録そのものが無い。 */
  signedIn: boolean;
  shops: Shop[];
  /**
   * 記録の件数。
   *
   * **`shops.length` で代用しない。** データから消えた店の記録は一覧に出ないので、
   * 記録が残っているのに消す導線まで消える（Codex の指摘で気付いた）。
   */
  recordCount: number;
  progress?: VisitSummary;
  selectedId?: string;
  onSelect: (shop: Shop) => void;
  /** 選択中のカードの直下に出すもの。 */
  detail?: ReactNode;
  /** 記録を全部消す。 */
  onForget: () => void;
  /** 会話でサインインを頼む。 */
  onSignIn?: () => void;
  asking: boolean;
  busy: boolean;
}

/** 「N 軒 / M 軒（P%）」と、その割合を示す帯。 */
function Bar({ visited, total, percent }: { visited: number; total: number; percent: number }) {
  return (
    <div
      className={styles.progressBar}
      role="img"
      aria-label={`${total} 軒中 ${visited} 軒（${percent}%）`}
    >
      {/* 幅は割合そのもの。トークンに無い値だが、これは見た目ではなくデータ。 */}
      <span className={styles.progressFill} style={{ width: `${percent}%` }} />
    </div>
  );
}

/**
 * 行った店と制覇率。
 *
 * **順位も称号も作らない。** 持っているのは「行った軒数」と「全体の軒数」だけで、
 * 頑張りの度合いを語る材料は無い。数と割合をそのまま出す。
 */
export function VisitedPanel({
  signedIn,
  shops,
  recordCount,
  progress,
  selectedId,
  onSelect,
  detail,
  onForget,
  onSignIn,
  asking,
  busy,
}: Props) {
  /*
   * 「消す」は 2 段階にする。元に戻せない操作を 1 回の誤操作で通さない。
   * ダイアログを出さないのは、ホストの iframe の中に別の面を重ねると、
   * 狭いホストでは枠の外に出てしまうため。
   */
  const [confirming, setConfirming] = useState(false);
  /*
   * 押した釦はその場で別の釦に入れ替わり、焦点が body に落ちる（#164）。キーボードで
   * 押したとき（click の detail が 0）だけ、入れ替わった先へ焦点を送る。確認の段では
   * 消さない方の「やめる」へ送り、Enter の押し続けで消してしまわないようにする。
   */
  const focusNext = useRef(false);
  const toggle = (next: boolean) => (event: MouseEvent) => {
    focusNext.current = event.detail === 0;
    setConfirming(next);
  };
  const takeFocus = (el: HTMLButtonElement | null) => {
    if (el && focusNext.current) {
      focusNext.current = false;
      el.focus();
    }
  };
  const view = visitedView(shops.length, recordCount);

  if (!signedIn) {
    return (
      <section className={styles.signIn} aria-label="行った店">
        <p className={styles.signInLead}>{SIGN_IN_NOTE}</p>
        {onSignIn && <p className={styles.selectedNote}>{SIGN_IN_WHY}</p>}
        {onSignIn && (
          <button type="button" className={styles.button} onClick={onSignIn} disabled={asking}>
            {asking ? "送信中…" : "チャットでサインインする"}
          </button>
        )}
      </section>
    );
  }

  return (
    <div className={styles.visited}>
      {progress && (
        <section className={styles.progress} aria-label="制覇率">
          <div className={styles.progressHead}>
            <span className={styles.progressCount}>
              {progress.overall.visited} / {progress.overall.total} 軒
            </span>
            <span className={styles.progressPercent}>{progress.overall.percent}%</span>
          </div>
          <Bar {...progress.overall} />

          {progress.prefectures.length > 0 && (
            <ul className={styles.progressList}>
              {progress.prefectures.map((row) => (
                <li key={row.prefecture} className={styles.progressRow}>
                  <span className={styles.progressName}>{row.prefecture}</span>
                  <Bar {...row} />
                  <span className={styles.progressCell}>
                    {row.visited}/{row.total}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <ShopList
        shops={shops}
        selectedId={selectedId}
        onSelect={onSelect}
        detail={detail}
        emptyMessage={view.empty}
      />

      {view.showForget && (
        <div className={styles.forget}>
          {confirming ? (
            <>
              <p className={styles.selectedNote}>{FORGET_WARN}</p>
              <div className={styles.forgetActions}>
                <button
                  type="button"
                  className={styles.buttonDanger}
                  onClick={() => {
                    setConfirming(false);
                    onForget();
                  }}
                  disabled={busy}
                >
                  本当に全部消す
                </button>
                <button
                  type="button"
                  className={styles.buttonSecondary}
                  ref={takeFocus}
                  onClick={toggle(false)}
                >
                  やめる
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className={styles.buttonSecondary}
              ref={takeFocus}
              onClick={toggle(true)}
              disabled={busy}
            >
              記録を全部消す
            </button>
          )}
        </div>
      )}
    </div>
  );
}
