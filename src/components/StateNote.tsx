import type { ReactNode } from "react";
import styles from "../mcp-app.module.css";

/*
 * 和文は 1 文を 1 本の文字列にする（JSX の改行は空白 1 個に畳まれる）。
 * 検索が空のときの次の行動。報告の口は結果の下に常にある（ReportEntry）。
 */
export const REPORT_HINT =
  "知っている店が出てこないときは、下の「お探しの家系が見つからないときは」から教えてください。";

const KIND_CLASS = {
  empty: styles.stateEmpty,
  loading: styles.stateLoading,
  error: styles.stateError,
} as const;

interface Props {
  kind: "empty" | "loading" | "error";
  children: ReactNode;
  /** 添える案内（空のときの報告の口など）。 */
  hint?: string;
  /** 次にできること（もう一度試す、など）。 */
  action?: { label: string; onClick: () => void };
}

/**
 * 空・読み込み中・エラーの見せ方を 1 つにそろえる（#129）。
 *
 * どれも「いま何が起きているか」と「次にできること」を並べる。初めての人ほど、
 * 理由も行き先も無い空の画面で離れる。エラーは原因と次の行動を淡々と書く。
 *
 * 読み上げ: 読み込み中は status（割り込まない）、エラーは alert（すぐ伝える）。
 */
export function StateNote({ kind, children, hint, action }: Props) {
  const role = kind === "error" ? "alert" : kind === "loading" ? "status" : undefined;
  return (
    <div className={KIND_CLASS[kind]} role={role}>
      {/* 海苔 3 枚の印。読み込み中だけ順に濃くなる（動きを減らす設定では止まる）。 */}
      <span className={styles.stateMark} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <p className={styles.stateText}>{children}</p>
      {hint && <p className={styles.stateHint}>{hint}</p>}
      {action && (
        <button type="button" className={styles.buttonSecondary} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
