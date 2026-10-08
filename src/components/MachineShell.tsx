import { useId, type ReactNode } from "react";
import styles from "../mcp-app.module.css";

interface Props {
  /** 券売機の名前（「家系 券売機」「店名の券売機」など）。 */
  title: string;
  /** 右上の短い案内（「押して、発券」など）。 */
  hint: string;
  /** 会話の中では小さく出す（見出しの帯と但し書きを省く）。 */
  compact?: boolean;
  children: ReactNode;
}

/**
 * 券売機の枠（#144）。迷ったら・店名で・現在地からの 3 つが同じ枠を使う。
 * どの探し方も「キーを選んで、発券すると食券が出る」体験にそろえる。
 */
export function MachineShell({ title, hint, compact, children }: Props) {
  const id = useId();
  return (
    <section className={compact ? styles.machineCompact : styles.machine} aria-labelledby={id}>
      <div className={styles.machineTop}>
        <h2 className={styles.machineTitle} id={id}>
          {title}
        </h2>
        <span className={styles.machineHint}>{hint}</span>
      </div>
      <div className={styles.machinePanel}>{children}</div>
      {/* 但し書きは券売機の下ではなく、出てきた結果の下に 1 回（#152）。 */}
      <div className={styles.machineSlot} aria-hidden="true" />
    </section>
  );
}
