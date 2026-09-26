import styles from "../mcp-app.module.css";

/**
 * 地図の全画面化。
 *
 * **ホストが対応していないときは渡さない（＝釦ごと出さない）。** 押しても
 * 何も起きない釦は、壊れているのか自分の操作が悪いのか分からない。
 */
export interface FullscreenControl {
  expanded: boolean;
  onToggle: () => void;
}

/* 和文は 1 文を 1 本の文字列にする（JSX の改行は空白 1 個に畳まれる）。 */
const EXPAND = "地図を広げる";
const SHRINK = "元の大きさに戻す";

interface Props {
  fullscreen?: FullscreenControl;
}

/**
 * 地図の上に置く操作列。
 *
 * 地図そのもの（Leaflet）と操作は別々にしてある。MapView に釦を足すと、
 * 地図の生成と後始末に画面の都合が混ざる。
 */
export function MapToolbar({ fullscreen }: Props) {
  if (!fullscreen) return null;

  return (
    <div className={styles.mapToolbar}>
      <button type="button" className={styles.buttonSecondary} onClick={fullscreen.onToggle}>
        {fullscreen.expanded ? SHRINK : EXPAND}
      </button>
    </div>
  );
}
