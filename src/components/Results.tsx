import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { AppPayload, Bounds, SearchMode, Shop } from "../lib/types";
import type { ResultLook } from "../lib/skeleton";
import { DecidePanel } from "./DecidePanel";
import { Pending } from "./Pending";
import type { FullscreenControl } from "./MapToolbar";
import { preloadMapView } from "./lazy-map";
import { ResultView } from "./ResultView";
import { ResultCaveat } from "./ResultCaveat";
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
 *
 * **並びは食券（答え）が先、券売機が後**（#204）。スマホ幅では 3 軒を最初の画面に入れ、券売機は
 * 「条件を変えて発券し直す」場所として下に置く（会話の中と同じ並び）。パソコン幅は CSS の格子で
 * 左に券売機、右に食券のまま（見た目は変えない）。読み上げと Tab の順も見た目にそろえる
 * （スマホ幅は答えが先、パソコン幅は券売機が先）。
 */
/** パソコン幅（券売機と食券を左右に並べる幅。mcp-app.module.css の .decideStage と同じ）。 */
const WIDE = "(min-width: 64rem)";
const subscribeWide = (on: () => void) => {
  const q = matchMedia(WIDE);
  q.addEventListener("change", on);
  return () => q.removeEventListener("change", on);
};
const isWide = () => matchMedia(WIDE).matches;
const subscribeWidth = (on: () => void) => {
  addEventListener("resize", on);
  return () => removeEventListener("resize", on);
};
const innerWidthNow = () => window.innerWidth;

/**
 * 3 軒の並びの一番高い値。画面の幅が変わったら（向きを変えたなど）測り直す。
 * ponytail: ページの間だけ覚える。並びの高さがページをまたいで変わることは無いので、保存はしない。
 */
let tallest = { width: 0, height: 0 };
function keepTallest(height: number, width: number): number {
  if (width !== tallest.width) tallest = { width, height: 0 };
  tallest.height = Math.max(tallest.height, height);
  return tallest.height;
}

function DecideStage({
  aside,
  status,
  failure,
  panel,
  look,
}: {
  aside: ReactNode;
  status: ReactNode;
  failure: string | null;
  panel: ReactNode;
  look: ResultLook;
}) {
  const out = useRef<HTMLDivElement>(null);
  // 骨組み・薄い結果の間は「出た」に数えない（届いたときに 1 回だけ戻す）。
  const shown = !status && look === "live";
  /*
   * 下の券売機で発券し直すと、新しい食券は画面の上の外に出る（スマホ幅）。**食券が丸ごと画面より
   * 上にあるときだけ**、そこまで戻す。頭が少し上にはみ出ているだけで戻すと、「次の 3 軒を見る」を
   * 押すたびに画面が動き、押したボタンが指の下から逃げた（#214、オーナーの指摘）。
   */
  useEffect(() => {
    const el = out.current;
    if (shown && el && el.getBoundingClientRect().bottom < 0) el.scrollIntoView({ block: "start" });
  }, [shown]);
  /*
   * 3 軒の並びの高さは、このページで出た一番高いものを保つ（#214、オーナーの指摘）。営業時間の行の
   * 有無で食券の高さが 106〜131px と違い、入れ替わるたびに下の「次の 3 軒を見る」が上下していた。
   * 縮めないので、押したボタンが上へ逃げない。作り直されても覚えておくため、部品の外に持つ。
   */
  // 向きを変えるなど幅が変わったら、前の幅で測った高さを外して測り直す（#214 のレビュー）。
  const width = useSyncExternalStore(subscribeWidth, innerWidthNow, () => 0);
  useLayoutEffect(() => {
    const box = out.current;
    // 店の詳細（食券の中）の並びではなく、3 軒の並びそのもの。
    const list = box?.querySelector<HTMLElement>("ul:not(li ul)");
    if (!shown || !box || !list) return;
    box.style.removeProperty("--tickets-min");
    // 一覧ではなく外の箱に持たせる。待つ間は一覧が包み直されて作り直され、一覧に書いた高さは消えた。
    box.style.setProperty(
      "--tickets-min",
      `${keepTallest(list.getBoundingClientRect().height, width)}px`,
    );
  }, [shown, width]);
  // 読む順（Tab・読み上げ）は見た目の順にそろえる。パソコン幅は左の券売機が先。
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  const result = (
    <div key="out" className={styles.decideOut} ref={out}>
      <FailureNote failure={status ? null : failure} />
      {status ?? <Pending look={look}>{panel}</Pending>}
    </div>
  );
  // key で並べ替えるので、幅が変わっても券売機は作り直さない（選んだキーを保つ）。
  const machine = <Fragment key="machine">{aside}</Fragment>;
  return (
    <div className={aside ? styles.decideStage : undefined}>
      {wide ? [machine, result] : [result, machine]}
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
  /** payload が今のモードのものか（待つ間に骨組み・前の結果を出すときも立つ）。揃うまで結果を出さない。 */
  ready: boolean;
  /** 結果の領域の見え方（#214）。待つ間は前の結果を薄く残すか、骨組みを出す。 */
  look: ResultLook;
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
  look,
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
   * つながる前も骨組みでここを描くので、結果が出るまで（live になるまで）待つ。最初の結果を
   * 取りに行く通信と帯域を取り合わせない（#214 のレビュー）。import は 2 回目から手元のものを返す。
   */
  const live = look === "live";
  useEffect(() => {
    if (live) preloadMapView();
  }, [live]);
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
        <Pending look={look}>
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
        </Pending>
        {/* 行った店も店の判定と味を出すので、但し書きを 1 回（#152）。 */}
        {shops.length > 0 && <ResultCaveat reports={reports} />}
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
        look={look}
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
            reports={reports}
            prefecture={payload.query.prefecture}
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
        look={look}
        reportHint={reportHint}
      />
      {/* 但し書きは結果のすぐ下に 1 回（#152）。出す店が無いときは言うことが無い。 */}
      {!status && shops.length > 0 && <ResultCaveat reports={reports} />}
    </>
  );
}
