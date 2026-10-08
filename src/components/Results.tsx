import { useEffect, type ReactNode } from "react";
import type { AppPayload, Bounds, SearchMode, Shop } from "../lib/types";
import { DecidePanel } from "./DecidePanel";
import type { FullscreenControl } from "./MapToolbar";
import { preloadMapView } from "./lazy-map";
import { ResultView } from "./ResultView";
import { REPORT_HINT, StateNote } from "./StateNote";
import styles from "../mcp-app.module.css";
import { VisitedPanel } from "./VisitedPanel";

/* 和文は 1 文を 1 本の文字列にする（JSX の改行は空白 1 個に畳まれる）。 */
const LOADING = "読み込み中…";
const NEEDS_SEARCH = "条件が変わりました。「発券する」を押してください。";
const UNAVAILABLE = "結果を取得できませんでした。通信が切れたか、サーバーが応答しませんでした。";

/**
 * 揃うまでの表示。読み込み中・検索待ち・失敗（もう一度試す）を StateNote でそろえる。
 * 失敗の理由があれば、同じ表示の中に添える（別の欄に分けると、1 回の失敗で 2 つ読み上げる）。
 */
function notReadyState(
  busy: boolean | undefined,
  needsSearch: boolean,
  failure: string | null,
  onRetry: () => void,
) {
  if (busy) return <StateNote kind="loading">{LOADING}</StateNote>;
  if (needsSearch) return <StateNote kind="empty">{NEEDS_SEARCH}</StateNote>;
  return (
    <StateNote
      kind="error"
      hint={failure ?? undefined}
      action={{ label: "もう一度試す", onClick: onRetry }}
    >
      {UNAVAILABLE}
    </StateNote>
  );
}

/**
 * 揃うまでの間も、結果の側に絞り込み（地図の belowMap・券売機の aside）を残すか。
 * 残すときは状態の表示を結果の中に差し替え、絞り込みの位置を変えない（焦点を保つ）。
 */
function keepsControls(mode: SearchMode, belowMap: ReactNode, aside: ReactNode) {
  return (mode === "map" && Boolean(belowMap)) || (mode === "decide" && Boolean(aside));
}

/**
 * 券売機（aside）と食券を 1 つの舞台に並べる（Web）。揃うまでの間は食券の側だけを
 * 状態に差し替え、券売機は同じ位置（同じ要素）に残す。会話の中は aside が無い。
 */
function DecideStage({
  aside,
  status,
  failure,
  panel,
}: {
  aside: ReactNode;
  status: ReactNode;
  failure: string | null;
  panel: ReactNode;
}) {
  return (
    <div className={aside ? styles.decideStage : undefined}>
      {aside}
      <div className={styles.decideOut}>
        <FailureNote failure={status ? null : failure} />
        {status ?? panel}
      </div>
    </div>
  );
}

/** 結果は出ているが、別の呼び出し（地名の解決など）が失敗したとき。 */
function FailureNote({ failure }: { failure: string | null }) {
  return failure ? <StateNote kind="error">{failure}</StateNote> : null;
}

interface Props {
  /** 地図と一覧の間に置くもの。ResultView へそのまま渡す。 */
  belowMap?: ReactNode;
  /**
   * 「迷ったら」で食券の隣に置くもの（Web の券売機、#144）。揃うまでの間も同じ位置に
   * 残し、押した「発券する」から焦点を落とさない。
   */
  aside?: ReactNode;
  /** 食券の列の見出し（Web の「迷ったら」）。ページの見出しから移したもの。 */
  decideTitle?: { heading: string; tag: string | null };
  /** 取得に失敗したとき、最後に送った条件のまま取り直す。 */
  onRetry: () => void;
  /** 呼び出しの失敗の理由。結果の代わりに出す失敗と 1 つにまとめる（読み上げを 2 回にしない）。 */
  failure: string | null;
  /** 報告の口があるか（Web だけ）。無いホストで「下から教えて」と案内しない。 */
  reports: boolean;
  mode: SearchMode;
  payload: AppPayload;
  /** payload が今のモードのものか。揃うまで結果を出さない。 */
  ready: boolean;
  /** 応答を待つ間に条件を編集したため、再検索が必要。 */
  needsSearch: boolean;
  shops: Shop[];
  /** いま効いているキーワード（「迷ったら」のみ）。 */
  keyword?: string;
  /** そのキーワードを外して引き直す。 */
  onClearKeyword: () => void;
  selected: Shop | null;
  onSelect: (shop: Shop | null) => void;
  onAsk?: (shops: Shop[], basis: string) => void;
  onReroll: () => void;
  asking: boolean;
  busy: boolean;
  /** 選んだカードの直下に出すもの。 */
  detail?: ReactNode;
  /** 「まわる店」の順路。地図モードで線を引くために通す。 */
  route?: Shop[];
  routeOrigin?: { lat: number; lon: number };
  /** 地図の全画面化。地図モードでしか使わないが、持ち主は画面の組み立て側。 */
  fullscreen?: FullscreenControl;
  /** 地図に出ている範囲で探し直す。 */
  onSearchArea?: (bounds: Bounds) => void;
  /** サインインしているか。記録まわりの出し分けに使う。 */
  signedIn: boolean;
  /** 訪問済みの店舗 ID。匿名なら空。 */
  visitedIds: ReadonlySet<string>;
  /** 記録を全部消す。 */
  onForget: () => void;
  /** 会話でサインインを頼む。 */
  onSignIn?: () => void;
}

/**
 * 結果の表示。モードごとの出し分けをここに隔離する。
 *
 * 画面の組み立て側に並べると、1 つの関数に分岐が集まりすぎて読めなくなる
 * （react-doctor の複雑度でも落ちた）。条件入力欄を ModeControls に出したのと同じ扱い。
 */
export function Results({
  failure,
  reports,
  onRetry,
  belowMap,
  aside,
  decideTitle,
  mode,
  payload,
  ready,
  needsSearch,
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
  fullscreen,
  onSearchArea,
  signedIn,
  visitedIds,
  onForget,
  onSignIn,
}: Props) {
  /*
   * 結果が出た後に、地図（Leaflet）を先に読んでおく（lazy-map.ts の preloadMapView・#154）。
   * 「迷ったら」は ResultView を描かないので、どのモードでも描くここで始める。
   */
  useEffect(preloadMapView, []);
  /*
   * 「行った店」だけは ready を待たずに出す道がある。
   *
   * **匿名では tool を呼んでいない**（401 を受けてもホストはサインインの画面を
   * 出さないため）。payload は前のモードのままなので ready は立たず、
   * 素直に待つと「結果を取得できませんでした」という嘘の失敗が出る。
   */
  if (mode === "visited" && !signedIn) {
    // サインインの依頼（チャットへの送信）が失敗したときの理由は、この道でも出す。
    return (
      <>
        <FailureNote failure={failure} />
        <VisitedPanel
          signedIn={false}
          shops={[]}
          recordCount={0}
          selectedId={selected?.id}
          onSelect={onSelect}
          onForget={onForget}
          onSignIn={onSignIn}
          asking={asking}
          busy={busy}
        />
      </>
    );
  }

  /*
   * タブを押すと mode だけ先に変わり、payload は tool の結果が届いてから
   * 差し替わる。呼び出しが失敗すると前のモードの結果が残るので、揃うまで出さない。
   * 出してしまうと、地図の 558 件が「迷ったら」の候補として並び、
   * 「この 558 軒から選ぶ」ボタンまで押せてしまう。
   */
  const status = ready
    ? undefined
    : // 券売機（decide）も、押し直したキーで古い応答を捨てたら「発券する」へ案内する。
      // 失敗の「もう一度試す」にすると、古い発券をやり直して押し直したキーが戻る（#144）。
      notReadyState(busy, needsSearch && (mode === "form" || mode === "decide"), failure, onRetry);
  const reportHint = reports ? REPORT_HINT : undefined;
  /*
   * Web の地図は絞り込みを地図の下に持つので、揃うまでの間も ResultView に描かせて
   * 絞り込みの位置を変えない（焦点を保つ）。古い結果そのものは ResultView が出さない。
   */
  if (status && !keepsControls(mode, belowMap, aside)) return status;

  if (mode === "visited") {
    return (
      <>
        <FailureNote failure={failure} />
        <VisitedPanel
          signedIn
          shops={shops}
          recordCount={visitedIds.size}
          progress={payload.progress}
          selectedId={selected?.id}
          onSelect={onSelect}
          detail={detail}
          onForget={onForget}
          onSignIn={onSignIn}
          asking={asking}
          busy={busy}
        />
      </>
    );
  }

  if (mode === "decide") {
    /*
     * 券売機（aside）と食券を 1 つの舞台に並べる。揃うまでの間は食券の側だけを状態に
     * 差し替え、券売機は同じ位置（同じ要素）に残す。
     */
    return (
      <DecideStage
        aside={aside}
        status={status}
        failure={failure}
        panel={
          <DecidePanel
            title={decideTitle}
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
            reportHint={reportHint}
          />
        }
      />
    );
  }

  /*
   * 揃うまでの間（status あり）は、失敗の理由を status の中に出しているので重ねない。
   * どちらでも同じ形（Fragment の中の ResultView）で返し、絞り込みを作り直さない。
   */
  return (
    <>
      <FailureNote failure={status ? null : failure} />
      <ResultView
        mode={mode}
        shops={shops}
        selectedId={selected?.id}
        onSelect={onSelect}
        detail={detail}
        route={route}
        routeOrigin={routeOrigin}
        fullscreen={fullscreen}
        onSearchArea={onSearchArea}
        bounds={payload.query.bounds}
        origin={payload.query.origin}
        busy={busy}
        visitedIds={visitedIds}
        belowMap={belowMap}
        status={status}
        reportHint={reportHint}
      />
    </>
  );
}
