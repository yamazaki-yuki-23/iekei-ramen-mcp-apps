import type { ReactNode } from "react";
import styles from "../styles/search.module.css";

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
  /** 釦を押した後の経過（地名を探している、見つからなかった）。待ち受けの読み上げ領域に出す。 */
  status?: string;
  /**
   * 結果が入れ替わったときに読み上げる文（use-result-announcement.ts）。画面の文をそのまま
   * 複製すると、同じ文が 2 か所に並ぶので、短い別の言い方を渡す。
   */
  announce?: string;
}

/**
 * 0 件の結果を読み上げるときの文。**見出しの横に件数を出さない「迷ったら」だけで使う。**
 * ほかの探し方は見出しの件数（「0 軒」）が読まれるので、渡すと 0 軒を 2 度読む。
 */
export const ZERO_ANNOUNCE = "見つかった店は 0 軒";

/**
 * 空・読み込み中・エラーの見せ方を 1 つにそろえる（#129）。
 *
 * どれも「いま何が起きているか」と「次にできること」を並べる。初めての人ほど、
 * 理由も行き先も無い空の画面で離れる。エラーは原因と次の行動を淡々と書く。
 *
 * 読み上げ: 読み込み中は status（割り込まない）、エラーは alert（すぐ伝える）。
 */
export function StateNote({ kind, children, hint, action, status, announce }: Props) {
  const role = kind === "error" ? "alert" : kind === "loading" ? "status" : undefined;
  const button = action && (
    <button type="button" className={styles.buttonSecondary} onClick={action.onClick}>
      {action.label}
    </button>
  );
  return (
    <div
      className={KIND_CLASS[kind]}
      role={role}
      data-announce={announce ? true : undefined}
      data-announce-text={announce}
    >
      {/* 海苔 3 枚の印。読み込み中だけ順に濃くなる（動きを減らす設定では止まる）。 */}
      <span className={styles.stateMark} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <p className={styles.stateText}>{children}</p>
      {/*
       * 空のときは、次にできること（地名で探す、#401）を先に、報告の案内を後に置く。報告は最後の口。
       * 失敗のときは、理由を読んでから「もう一度試す」を押すので、案内が先。
       */}
      {kind === "empty" && button}
      {status !== undefined && (
        <p className={styles.stateHint} role="status">
          {status}
        </p>
      )}
      {hint && <p className={styles.stateHint}>{hint}</p>}
      {kind !== "empty" && button}
    </div>
  );
}
