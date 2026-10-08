import type { ReactNode } from "react";
import { basisLabel, describeBasis, pickRange } from "../lib/shortlist";
import type { DecideInfo, Origin, Shop } from "../lib/types";
import styles from "../mcp-app.module.css";
import { ResultCaveat } from "./ResultCaveat";
import { ShopList } from "./ShopList";
import { StateNote } from "./StateNote";

/* 和文は 1 文を 1 本の文字列にする（JSX の改行は空白 1 個に畳まれる）。 */
const EMPTY = "条件に合う店舗が見つかりませんでした。都道府県や味の条件を緩めてください。";
/*
 * 「近くで」を頼まれたが現在地が分からなかった（#147）。条件はそのまま残るので、
 * 現在地の代わりになる口（都道府県・地図・地名）を案内する。「条件を緩めて」とは言わない。
 */
const NEEDS_ORIGIN =
  "現在地が分かりませんでした。券売機の「都道府県」か「地図で選ぶ」で探すか、「現在地から」で地名を入れてください。";
const EMPTY_WITH_KEYWORD =
  "条件に合う店舗が見つかりませんでした。上のキーワードを外すか、都道府県や味の条件を緩めてください。";
/* 会話の中だけ。選んだ店をチャットで聞く道を言う（但し書きは ResultCaveat）。 */
const ASK_HINT = "気になる店は押して選んでから、チャットで聞いてください。";

/** 食券の列の見出し。並べた根拠（近い順など）を札で横に添える。 */
function DecideHead({ title }: { title?: { heading: string; tag: string | null } }) {
  if (!title) return null;
  return (
    <div className={styles.decideHead}>
      <h2 className={styles.decideTitle}>{title.heading}</h2>
      {title.tag && <span className={styles.count}>{title.tag}</span>}
    </div>
  );
}

/** 末尾まで来たら先頭へ戻る。押す前に何が起きるかを言う。 */
/** 0 軒のときの案内。現在地が分からなかったときは、条件を緩めてではなく代わりの口へ。 */
function EmptyNote({
  needsOrigin,
  keyword,
  reportHint,
}: {
  needsOrigin?: boolean;
  keyword?: string;
  reportHint?: string;
}) {
  if (needsOrigin) return <StateNote kind="empty">{NEEDS_ORIGIN}</StateNote>;
  return (
    <StateNote kind="empty" hint={reportHint}>
      {keyword ? EMPTY_WITH_KEYWORD : EMPTY}
    </StateNote>
  );
}

/**
 * 何軒の中の何軒目か（#152）。「全国 352 軒中、近い順に 1〜3 軒目」。
 * 母数は地域で絞った数ではないので、どこの数かを必ず書く。見出しが「さいたま市付近」の
 * ときに「352 軒中」だけだと、その近くに 352 軒あると読まれた。
 */
function roundLabel(info: DecideInfo, shown: number, prefecture?: string): string {
  return `${prefecture || "全国"} ${info.poolTotal} 軒中、${basisLabel(info)}に ${pickRange(info, shown)}`;
}

function rerollLabel(info: DecideInfo | undefined): string {
  return info && info.rounds > 1 && info.round + 1 >= info.rounds
    ? "最初の 3 軒に戻る"
    : "次の 3 軒を見る";
}

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
  onAsk?: (shops: Shop[], basis: string) => void;
  /** 次の 3 軒に入れ替える。 */
  onReroll: () => void;
  asking: boolean;
  busy: boolean;
  /** 選んだカードの直下に出すもの。 */
  detail?: ReactNode;
  /** 0 件のときに添える、報告の口への案内。報告できないホストでは渡さない。 */
  reportHint?: string;
  /** 報告の口があるか（Web）。但し書きの報告の案内を変える。 */
  reports: boolean;
  /** 絞り込んだ都道府県。母数が全国か県かを書くのに使う。 */
  prefecture?: string;
  /** 列の見出しと、並べた根拠の札（Web の「迷ったら」）。会話の中ではページの見出しが持つ。 */
  title?: { heading: string; tag: string | null };
}

/**
 * 「迷ったら」モード（コード上の名前は decide）。
 *
 * 558 件の一覧は選択肢地獄で、人は理由の無い長い一覧からは決められない。
 * 3 軒まで落とし、決める仕事はモデルに渡す。
 *
 * **なぜこの 3 軒なのかを必ず画面に出す。** 出さないと、根拠の無い
 * 「おすすめ」を押し付けているように見える。実際には距離か営業時間の有無で
 * 並べているだけなので、そう書く。Web は見出しの札、会話の中は短い 1 行（#152）。
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
  reportHint,
  reports,
  prefecture,
  title,
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
        <EmptyNote needsOrigin={info?.needsOrigin} keyword={keyword} reportHint={reportHint} />
      </section>
    );
  }

  return (
    <section className={styles.decide} aria-label="迷ったら">
      {filter}
      {/*
       * 並べた根拠の長い文（「352 軒を…に並べた、1〜3 軒目です。」）は画面に出さない（#152）。
       * 見出し（どこから）・札（近い順など）・「全国 352 軒中、近い順に 1〜3 軒目」で足りる。文はモデルへ渡す。
       */}
      <DecideHead title={title} />
      {!title && info && (
        <p className={styles.decideBasis}>{`${basisLabel(info)}に並べています。`}</p>
      )}

      <ShopList
        shops={shops}
        ranked
        ticket
        selectedId={selectedId}
        onSelect={onSelect}
        detail={detail}
      />

      <div className={styles.decideActions}>
        {onAsk && (
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
        )}
        <button
          type="button"
          className={styles.buttonSecondary}
          onClick={onReroll}
          disabled={busy || (info?.rounds ?? 1) <= 1}
        >
          {rerollLabel(info)}
        </button>
        {info && info.rounds > 1 && (
          <span className={styles.decideRound}>{roundLabel(info, shops.length, prefecture)}</span>
        )}
      </div>

      <ResultCaveat reports={reports} />
      {onAsk && <p className={styles.selectedNote}>{ASK_HINT}</p>}
    </section>
  );
}
