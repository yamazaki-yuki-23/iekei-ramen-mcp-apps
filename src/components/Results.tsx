import type { ReactNode } from "react";
import type { AppPayload, SearchMode, Shop } from "../lib/types";
import styles from "../mcp-app.module.css";
import { DecidePanel } from "./DecidePanel";
import { ResultView } from "./ResultView";

/* 和文は 1 文を 1 本の文字列にする（JSX の改行は空白 1 個に畳まれる）。 */
const LOADING = "読み込み中…";
const UNAVAILABLE = "結果を取得できませんでした。もう一度お試しください。";

interface Props {
  mode: SearchMode;
  payload: AppPayload;
  /** payload が今のモードのものか。揃うまで結果を出さない。 */
  ready: boolean;
  shops: Shop[];
  /** いま効いているキーワード（「迷ったら」のみ）。 */
  keyword?: string;
  /** そのキーワードを外して引き直す。 */
  onClearKeyword: () => void;
  selected: Shop | null;
  onSelect: (shop: Shop | null) => void;
  onAsk: (shops: Shop[], basis: string) => void;
  onReroll: () => void;
  asking: boolean;
  busy: boolean;
  /** 選んだカードの直下に出すもの。 */
  detail?: ReactNode;
  /** 「まわる店」の順路。地図モードで線を引くために通す。 */
  route?: Shop[];
  routeOrigin?: { lat: number; lon: number };
}

/**
 * 結果の表示。モードごとの出し分けをここに隔離する。
 *
 * 画面の組み立て側に並べると、1 つの関数に分岐が集まりすぎて読めなくなる
 * （react-doctor の複雑度でも落ちた）。条件入力欄を ModeControls に出したのと同じ扱い。
 */
export function Results({
  mode,
  payload,
  ready,
  shops,
  keyword,
  onClearKeyword,
  selected,
  onSelect,
  onAsk,
  onReroll,
  asking,
  busy,
  detail,
  route,
  routeOrigin,
}: Props) {
  /*
   * タブを押すと mode だけ先に変わり、payload は tool の結果が届いてから
   * 差し替わる。呼び出しが失敗すると前のモードの結果が残るので、揃うまで出さない。
   * 出してしまうと、地図の 558 件が「迷ったら」の候補として並び、
   * 「この 558 軒から選ぶ」ボタンまで押せてしまう。
   */
  if (!ready) return <p className={styles.status}>{busy ? LOADING : UNAVAILABLE}</p>;

  if (mode === "decide") {
    return (
      <DecidePanel
        shops={shops}
        info={payload.decide}
        origin={payload.query.origin}
        keyword={keyword}
        onClearKeyword={onClearKeyword}
        selectedId={selected?.id}
        onSelect={onSelect}
        onAsk={onAsk}
        onReroll={onReroll}
        asking={asking}
        busy={busy}
        detail={detail}
      />
    );
  }

  return (
    <ResultView
      mode={mode}
      shops={shops}
      selectedId={selected?.id}
      onSelect={onSelect}
      detail={detail}
      route={route}
      routeOrigin={routeOrigin}
    />
  );
}
