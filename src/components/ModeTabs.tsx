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
}

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
}: Props) {
  const modes = [
    ...MODES.filter(({ key }) => key === primaryMode),
    ...MODES.filter(({ key }) => key !== primaryMode),
  ];
  return (
    <div className={styles.tabs} role="tablist">
      {modes
        .filter(({ key }) => key !== "visited" || visitsAvailable)
        .map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
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
