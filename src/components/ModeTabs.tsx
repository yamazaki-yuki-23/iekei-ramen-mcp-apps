import { MODE_PANEL_ID, modeTabId } from "../lib/mode-panel";
import type { ReactNode } from "react";
import type { SearchMode } from "../lib/types";
import styles from "../mcp-app.module.css";

const MODES: Array<{ key: SearchMode; label: string }> = [
  { key: "form", label: "検索フォーム" },
  { key: "nearby", label: "現在地から探す" },
  { key: "map", label: "地図から探す" },
  { key: "decide", label: "迷ったら" },
  // 匿名でも出す。押せば何のための画面かが分かり、そこからサインインへ進める。
  { key: "visited", label: "行った店" },
];

interface Props {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
  /**
   * 記録を書き換えている最中か。**ここだけは止める。**
   *
   * 記録の応答にも検索の応答にも、その時点の記録の全体が入っている。
   * 同時に走らせると**あとから届いた方が勝つ**ので、書き換えたばかりの印が
   * 古い写しで消える。書き換えは 1 往復で終わるので、止まって見える時間は
   * ほとんど無い（止めたかったのは 558 件を返す検索の方）。
   */
  mutating: boolean;
  /** 記録またはサインインの導線があるホストだけ、訪問記録を出す。 */
  visitsAvailable?: boolean;
  /** 入口で前に出すモード。現在のタブに合わせて並べ直さない。 */
  primaryMode?: SearchMode;
  /**
   * Web は券売機が主役なので、ほかの探し方は見出しの横の小さなリンクにする（#144）。
   * 会話の中（MCP）は従来どおりタブ。
   */
  variant?: "tabs" | "links";
}

/** リンクのときの言い方。券売機の画面から「ほかの探し方」として読めるように。 */
const LINK_LABEL: Record<SearchMode, string> = {
  decide: "迷ったら",
  map: "地図で",
  form: "店名で",
  nearby: "現在地から",
  visited: "行った店",
};

/**
 * モード切り替えのタブ。
 *
 * **読み込み中でも押せる。** 地図は 558 件を返すので、その間ずっと押せないと
 * 「壊れた」と読まれて押し直すことになる。押した操作が最後に効く方が読める。
 * 追い越しは呼び出し側が捨てる（[use-server-tools](../hooks/use-server-tools.ts)
 * の通し番号）。
 */
export function ModeTabs({
  mode,
  onChange,
  mutating,
  visitsAvailable = true,
  primaryMode = "form",
  variant = "tabs",
}: Props) {
  const modes = [
    ...MODES.filter(({ key }) => key === primaryMode),
    ...MODES.filter(({ key }) => key !== primaryMode),
  ];
  if (variant === "links") {
    return (
      <nav className={styles.modeLinks} aria-label="探し方">
        {modes
          .filter(({ key }) => key !== "visited" || visitsAvailable)
          .map(({ key }) => (
            <button
              key={key}
              type="button"
              aria-current={mode === key ? "page" : undefined}
              className={styles.modeLink}
              onClick={() => onChange(key)}
              disabled={mutating}
            >
              {LINK_LABEL[key]}
            </button>
          ))}
      </nav>
    );
  }
  return (
    <div className={styles.tabs} role="tablist">
      {modes
        .filter(({ key }) => key !== "visited" || visitsAvailable)
        .map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={modeTabId(key)}
            aria-controls={MODE_PANEL_ID}
            aria-selected={mode === key}
            className={`${styles.tab} ${mode === key ? styles.tabActive : ""}`}
            onClick={() => onChange(key)}
            disabled={mutating}
          >
            {label}
          </button>
        ))}
    </div>
  );
}

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
