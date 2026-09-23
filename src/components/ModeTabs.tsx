import type { SearchMode } from "../lib/types";
import styles from "../mcp-app.module.css";

const MODES: Array<{ key: SearchMode; label: string }> = [
  { key: "form", label: "検索フォーム" },
  { key: "nearby", label: "現在地から探す" },
  { key: "map", label: "地図から探す" },
  { key: "decide", label: "迷ったら" },
];

interface Props {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
  busy: boolean;
}

/** モード切り替えのタブ。 */
export function ModeTabs({ mode, onChange, busy }: Props) {
  return (
    <div className={styles.tabs} role="tablist">
      {MODES.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={mode === key}
          className={`${styles.tab} ${mode === key ? styles.tabActive : ""}`}
          onClick={() => onChange(key)}
          disabled={busy}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
