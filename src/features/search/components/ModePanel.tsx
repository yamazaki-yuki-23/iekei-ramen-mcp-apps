import { MODE_PANEL_ID, modeTabId } from "../utils/mode-panel";
import type { ReactNode } from "react";
import type { SearchMode } from "../../../types";
import styles from "../styles/search.module.css";

/**
 * 結果の領域。会話の中（タブ）では、タブと aria-controls・aria-labelledby で結ぶ（#156）。
 * Web はタブではなく探し方のリンクなので、役割は付けない。
 * 箱を 1 つ足すので、.main と同じ縦の並びと間隔にして配置を変えない。
 */
export function ModePanel({
  mode,
  tabs,
  children,
}: {
  mode: SearchMode;
  tabs: boolean;
  children: ReactNode;
}) {
  return (
    <div
      id={MODE_PANEL_ID}
      className={styles.modePanel}
      {...(tabs ? { role: "tabpanel", "aria-labelledby": modeTabId(mode) } : {})}
    >
      {children}
    </div>
  );
}
