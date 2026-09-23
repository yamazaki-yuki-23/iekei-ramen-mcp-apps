import type { ReactNode } from "react";
import { describeBasis } from "../lib/shortlist";
import type { DecideInfo, Origin, Shop } from "../lib/types";
import styles from "../mcp-app.module.css";
import { ShopList } from "./ShopList";

/* 和文は 1 文を 1 本の文字列にする（JSX の改行は空白 1 個に畳まれる）。 */
const EMPTY = "条件に合う店舗が見つかりませんでした。都道府県や味の条件を緩めてください。";
const EMPTY_WITH_KEYWORD =
  "条件に合う店舗が見つかりませんでした。上のキーワードを外すか、都道府県や味の条件を緩めてください。";
const NOTE =
  "並べる材料は家系判定の段階・距離・営業時間の有無だけです。味の濃さ・混雑・評判のデータは持っていないので、順位は「おすすめ度」ではありません。気になる店は押して選んでから、チャットで聞いてください。";

interface Props {
  shops: Shop[];
  /** 3 軒をどう選んだか。サーバーが返す。 */
  info?: DecideInfo;
  origin?: Origin;
  /** いま効いているキーワード。画面に出して、隠れた絞り込みにしない。 */
  keyword?: string;
  /** そのキーワードを外して引き直す。 */
  onClearKeyword: () => void;
  selectedId?: string;
  onSelect: (shop: Shop) => void;
  /** 3 軒をモデルに渡して 1 軒推してもらう。 */
  onAsk: (shops: Shop[], basis: string) => void;
  /** 次の 3 軒に入れ替える。 */
  onReroll: () => void;
  asking: boolean;
  busy: boolean;
  /** 選んだカードの直下に出すもの。 */
  detail?: ReactNode;
}

/**
 * 「迷ったら」モード（コード上の名前は decide）。
 *
 * 558 件の一覧は選択肢地獄で、人は理由の無い長い一覧からは決められない。
 * 3 軒まで落とし、決める仕事はモデルに渡す。
 *
 * **なぜこの 3 軒なのかを必ず画面に出す。** 出さないと、根拠の無い
 * 「おすすめ」を押し付けているように見える。実際には距離か営業時間の有無で
 * 並べているだけなので、そう書く。
 */
export function DecidePanel({
  shops,
  info,
  origin,
  keyword,
  onClearKeyword,
  selectedId,
  onSelect,
  onAsk,
  onReroll,
  asking,
  busy,
  detail,
}: Props) {
  const basis = info ? describeBasis(info, shops.length, origin, keyword) : "";

  /*
   * 効いているキーワードは、結果が 0 件のときこそ画面に要る。
   * モデルが絞って開いた場合、このモードにはキーワード欄が無いので、
   * 出さないと「なぜ 0 件なのか」も「どうすれば外れるのか」も分からない。
   */
  const filter = keyword ? (
    <div className={styles.decideFilter}>
      <span className={styles.badge}>キーワード「{keyword}」</span>
      <button
        type="button"
        className={styles.buttonSecondary}
        onClick={onClearKeyword}
        disabled={busy}
      >
        このキーワードを外す
      </button>
    </div>
  ) : null;

  if (shops.length === 0) {
    return (
      <section className={styles.decide} aria-label="迷ったら">
        {filter}
        <p className={styles.empty}>{keyword ? EMPTY_WITH_KEYWORD : EMPTY}</p>
      </section>
    );
  }

  return (
    <section className={styles.decide} aria-label="迷ったら">
      {filter}
      {basis && <p className={styles.decideBasis}>{basis}</p>}

      <ShopList shops={shops} ranked selectedId={selectedId} onSelect={onSelect} detail={detail} />

      <div className={styles.decideActions}>
        <button
          type="button"
          className={styles.button}
          onClick={() => onAsk(shops, basis)}
          disabled={asking || busy}
        >
          {asking
            ? "送信中…"
            : shops.length === 1
              ? "この 1 軒について聞く"
              : `この ${shops.length} 軒から選ぶ`}
        </button>
        <button
          type="button"
          className={styles.buttonSecondary}
          onClick={onReroll}
          disabled={busy || (info?.rounds ?? 1) <= 1}
        >
          別の候補を見る
        </button>
        {info && info.rounds > 1 && (
          <span className={styles.decideRound}>
            {info.round + 1} / {info.rounds} 巡目
          </span>
        )}
      </div>

      <p className={styles.selectedNote}>{NOTE}</p>
    </section>
  );
}
