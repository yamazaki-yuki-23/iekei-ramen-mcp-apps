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
const SEARCH_AREA = "この範囲で探す";

interface Props {
  fullscreen?: FullscreenControl;
  /** いま地図に出ている範囲で探し直す。 */
  onSearchArea?: () => void;
  busy?: boolean;
}

/**
 * 地図の上に置く操作列。
 *
 * 地図そのもの（Leaflet）と操作は別々にしてある。MapView に釦を足すと、
 * 地図の生成と後始末に画面の都合が混ざる。
 */
export function MapToolbar({ fullscreen, onSearchArea, busy = false }: Props) {
  if (!fullscreen && !onSearchArea) return null;

  return (
    <div className={styles.mapToolbar}>
      {/*
        動かしたかどうかでは出し分けない。Leaflet は自分で寄せたときにも
        同じ通知を出すので、「ユーザーが動かした」を見分けようとすると、
        取りこぼした側（釦が出ない／出っぱなし）が必ず残る。
        いつでも押せて、押せば出ている範囲を探す、で揃える。
      */}
      {onSearchArea && (
        <button
          type="button"
          className={styles.buttonSecondary}
          onClick={onSearchArea}
          disabled={busy}
        >
          {SEARCH_AREA}
        </button>
      )}
      {fullscreen && (
        <button type="button" className={styles.buttonSecondary} onClick={fullscreen.onToggle}>
          {fullscreen.expanded ? SHRINK : EXPAND}
        </button>
      )}
    </div>
  );
}
