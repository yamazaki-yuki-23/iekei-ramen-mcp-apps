import type { ReactNode } from "react";
import type { ResultLook } from "../utils/skeleton";
// 見た目は src/styles/global.css の .pending-*（全ページが最初から読む CSS。別の CSS に分けると最初の表示が遅れた）。
const LOOK_CLASS: Record<ResultLook, string> = {
  live: "pending-wrap",
  hold: "pending-wrap",
  dim: "pending-wrap pending-dim",
  skeleton: "pending-wrap pending-skeleton",
  reserve: "pending-wrap pending-skeleton pending-reserve",
};

/**
 * 待つ間の結果の領域（#214）。前の結果も骨組みも押せない（inert）。読み上げは中身を出さず、
 * 「読み込み中」を 1 回だけ伝える（見た目を変えていない 300ms までは伝えない）。
 *
 * **結果が出ている間も同じ包みで描く。** 待ち始めたときだけ包むと、中身が作り直されて食券が
 * 入ってくる動きをやり直し、前の結果が一度消えてから戻って見えた（#214 のレビュー）。
 * 包みは display: contents なので、並びには影響しない。
 */
export function Pending({ look, children }: { look: ResultLook; children: ReactNode }) {
  const waiting = look !== "live";
  return (
    <>
      {(look === "dim" || look === "skeleton") && (
        <p role="status" className="pending-status">
          読み込み中…
        </p>
      )}
      <div className={LOOK_CLASS[look]} aria-hidden={waiting || undefined} inert={waiting}>
        {children}
      </div>
    </>
  );
}
