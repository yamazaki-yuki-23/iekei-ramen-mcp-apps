import type { PresentationProps } from "../iekei-app";
import { originLabel } from "./geo";
import { scopeLabel } from "./scope";
import { basisLabel } from "./shortlist";
import type { AppPayload, DecideInfo, SearchMode } from "./types";

/** 結果が揃う前の見出し。前のモードの件数や条件を名乗らないための逃げ先。 */
const HEADING_BY_MODE: Record<SearchMode, string> = {
  form: "家系ラーメンを探す",
  nearby: "現在地から家系ラーメンを探す",
  map: "家系ラーメンを地図で見る",
  decide: "迷ったら",
  visited: "行った店",
};

/**
 * 見出しの文。
 *
 * 結果が揃う前は、前のモードの件数や条件を名乗らない（切り替えに失敗すると
 * 「迷ったらこの 558 軒（全国）」のような嘘の見出しが残る）。
 */
export function buildHeading(mode: SearchMode, payload: AppPayload, ready: boolean): string {
  if (!ready) return HEADING_BY_MODE[mode];
  /*
   * 「行った店」は条件で絞った一覧ではないので、「どこ」を名乗らせない。
   * 落ちると、空の query が「全国」と読まれて「全国の家系ラーメン」になる。
   */
  if (mode === "visited") return HEADING_BY_MODE.visited;
  if (mode === "nearby") {
    return payload.query.origin
      ? `${originLabel(payload.query.origin)}の近くの家系ラーメン`
      : HEADING_BY_MODE.nearby;
  }
  // 範囲で絞ったときに「全国」と名乗らない。語はサーバーの文と共通。
  const where = scopeLabel(payload.query);
  if (mode === "decide") {
    // 0 件のときに「この 0 軒」と名乗らない。件数はここでは意味を持たない。
    if (payload.shops.length === 0) return HEADING_BY_MODE.decide;
    const from = payload.query.origin ? originLabel(payload.query.origin) : where;
    return `迷ったらこの ${payload.shops.length} 軒（${from}）`;
  }
  return `${where}の家系ラーメン`;
}

/**
 * 見出しの横の件数。「判定した結果の 558 軒（200 軒を表示）」。
 *
 * 全国の総数ではなく、地図データを判定した結果の軒数なので、そう書く。
 * 「迷ったら」は件数の代わりに並べた根拠（「近い順」など）を出す。位置は 3 軒の下に
 * 出す（「352 件（3 件表示）」が何の件数か読めなかった）。行った店は記録の軒数。
 */
export function formatCount(
  mode: SearchMode,
  total: number,
  shown: number,
  decide: DecideInfo | undefined,
): string | null {
  // 0 軒のときは並べたものが無いので、根拠も名乗らない。
  if (mode === "decide") return decide && shown > 0 ? basisLabel(decide) : null;
  if (mode === "visited") return `${total} 軒`;
  const counted = `判定した結果の ${total} 軒`;
  return total > shown ? `${counted}（${shown} 軒を表示）` : counted;
}

/**
 * 見出しの割り振り。Web の「迷ったら」は券売機が主役なので、ページの見出しはサイトの
 * 名前にし、「迷ったら、この 3 軒（全国）」と並べた根拠は食券の列の見出しへ移す（#144）。
 * 結果の見出しが券売機より先に来ると、読む順が逆になった。
 */
export function pageHead(
  Hero: PresentationProps["hero"],
  mode: SearchMode,
  heading: string,
  count: string | null,
) {
  return Hero && mode === "decide"
    ? { h1: SITE_NAME, count: null, decideTitle: { heading, tag: count } }
    : { h1: heading, count, decideTitle: undefined };
}

const SITE_NAME = "家系ラーメンを探す";

/**
 * タブを押すと mode だけ先に変わり、payload は tool の結果が届いてから
 * 差し替わる。呼び出しが失敗すると前のモードの結果が残ったままになるので、
 * 揃うまでは結果を出さない。
 *
 * 揃っていないのに出すと、地図の 558 件が「迷ったら」の候補として並び、
 * 「この 558 軒から選ぶ」ボタンまで押せてしまう（実際にそうなっていた）。
 *
 * ただし「基準地点待ち」は失敗ではない。基準地点を知らないまま現在地モードへ
 * 入ったときは tool を呼ばないので payload は前のモードのままだが、出すべきは
 * 「地点を指定してください」であって「取得できませんでした」ではない。
 *
 * モードが同じままでも古くなることがある。決めきる画面で都道府県だけ変えて
 * 呼び出しが落ちると、mode も payload.mode も decide のままなので、この比較
 * だけでは気付けない。呼び直した時点で立つ stale も見る。
 */
export function isPayloadReady(
  payload: AppPayload,
  mode: SearchMode,
  awaitingOrigin: boolean,
  stale: boolean,
): boolean {
  return (payload.mode === mode || awaitingOrigin) && !stale;
}
