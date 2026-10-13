/**
 * 結果の画面。payload ごとに key で作り直される側（作り直されない外側は iekei-app.tsx）。
 */
import type { McpUiDisplayMode, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useMemo, useState, type ReactNode } from "react";
import { ModeControls } from "./components/ModeControls";
import { ModePanel, ModeTabs } from "./components/ModeTabs";
import type { FormValues } from "./components/SearchForm";
import { Results } from "./components/Results";
import { RoutePanel } from "./components/RoutePanel";
import { SelectedShop } from "./components/SelectedShop";
import { ReportEntry } from "./components/ReportForm";
import { useFullscreen } from "./hooks/use-fullscreen";
import { useModeSwitch } from "./hooks/use-mode-switch";
import { createStampQueue, useServerTools } from "./hooks/use-server-tools";
import { safeAreaStyle } from "./lib/safe-area";
import { DATA_CREDIT, DATA_DEFINITIONS, DATA_FOOTNOTE } from "./lib/data-caveats";
import { MAX_STOPS, planRoute } from "./lib/route";
import type { AppPayload, Origin, SearchMode, Shop, VisitResult } from "./lib/types";
import styles from "./mcp-app.module.css";
import type { UiHost } from "./hosts/types";
import { AppHeader } from "./components/AppHeader";
import type { PresentationProps } from "./iekei-app";
import { buildHeading, formatCount, isPayloadReady, pageHead } from "./lib/heading";
import { issueWith } from "./lib/issue-tickets";
export interface InnerProps extends PresentationProps {
  app: UiHost;
  payload: AppPayload;
  resultReceived: boolean;
  form: FormValues;
  onForm: (form: FormValues) => void;
  capturePayload: () => (payload: AppPayload) => boolean;
  /** 再マウントをまたいで残る案内メッセージ。 */
  notice: string | null;
  onNotice: (notice: string | null) => void;
  /** 選択中の店。モデルに渡す都合で外側が持つ。 */
  selected: Shop | null;
  onSelect: (shop: Shop | null) => void;
  /** 「まわる店」。検索をまたいで残るので、これも外側が持つ。 */
  stops: Shop[];
  /** 順路の出発点。最初に入れたときの基準地点で、検索では動かない。 */
  routeOrigin?: Origin;
  onAddStop: (shop: Shop, origin?: Origin) => void;
  onRemoveStop: (shop: Shop) => void;
  onClearStops: () => void;
  /** 記録の更新を反映する（検索結果の画面は動かさない）。 */
  onVisits: (next: VisitResult) => void;
  /** 返ってきていない呼び出しの数（外側が持つ）。 */
  pendingCalls: number;
  trackCall: (delta: 1 | -1) => void;
  /** 「行った」を 1 本ずつ送る列（外側が持つ）。 */
  stampQueue: ReturnType<typeof createStampQueue>;
  /** その店の詳細がモデルに届いたか。届いていなければ質問に詳細を同梱する。 */
  awaitContext: (shop: Shop) => Promise<boolean>;
  /** 選択を外し、モデル側から消えるまで待つ。 */
  releaseSelection: () => Promise<boolean>;
  /** 表示モードを変えてもらう。ホストが受けた実際のモードは hostContext に返る。 */
  onDisplayMode: (mode: McpUiDisplayMode) => Promise<void>;
  hostContext?: McpUiHostContext;
}

/** 対応している操作だけを部品に渡す。部品側はcallbackの有無で描画する。 */
function supportedAction<Action extends (...args: never[]) => unknown>(
  supported: boolean,
  action: Action,
): Action | undefined {
  return supported ? action : undefined;
}

/**
 * 絞り込みを置く場所。Web の地図だけ、地図と一覧の間に置く（#125）。
 * 最初の画面で地図が先に見え、絞り込みは一覧の 20 件より前に来る。
 * DOM の順で決める（CSS の order だと、読み上げと Tab の順が見た目とずれる）。
 *
 * 読み込み中・失敗のあいだも位置を変えない（ResultView が地図だけ状態に差し替える）。
 * 置き場所を切り替えると、押していた選択肢が作り直されて焦点が消える。
 */
function placeControls(Hero: PresentationProps["hero"], mode: SearchMode, controls: ReactNode) {
  /*
   * 会話の中（MCP）の「迷ったら」は、答え（食券）を先に出し、券売機は「条件を変えて
   * 発券し直す」場所として下に置く（#131 の「会話の中は控えめ」）。ほかは条件を上に。
   */
  if (!Hero && mode === "decide")
    return { top: null, after: controls, belowMap: undefined, aside: undefined, hero: null };
  if (!Hero)
    return { top: controls, after: null, belowMap: undefined, aside: undefined, hero: null };
  // Web の地図は、地図を先に見せ、絞り込みを地図と一覧の間に置く（#125）。
  if (mode === "map")
    return { top: null, after: null, belowMap: controls, aside: undefined, hero: null };
  /*
   * Web の「迷ったら」は券売機が主役（#144）。約束の一言の下で、券売機と食券を並べる。
   * 券売機は食券の隣（aside）に置き、揃うまでの間も同じ位置に残す（焦点を保つ）。
   */
  if (mode === "decide")
    return { top: null, after: null, belowMap: undefined, aside: controls, hero: <Hero /> };
  return { top: controls, after: null, belowMap: undefined, aside: undefined, hero: null };
}

/**
 * payload ごとに key で作り直されるので、状態は props からそのまま初期化できる。
 * tool 結果が届くたびにモードを揃え、フォームの下書きは外側で保持する。
 */
export function IekeiAppInner({
  introduction,
  hero: Hero,
  primaryMode,
  app,
  payload,
  resultReceived,
  form,
  onForm,
  capturePayload,
  notice,
  onNotice,
  selected,
  onSelect,
  stops,
  routeOrigin,
  onAddStop,
  onRemoveStop,
  onClearStops,
  onVisits,
  pendingCalls,
  trackCall,
  stampQueue,
  awaitContext,
  releaseSelection,
  onDisplayMode,
  hostContext,
}: InnerProps) {
  // payload が変わるたび key で作り直されるので、ここは「初期値を 1 度だけ写す」形。
  // 再同期しないことが前提なので、派生 state の警告はモードの初期値に限って外している。
  // react-doctor-disable-next-line react-doctor/no-derived-useState
  const [mode, setMode] = useState<SearchMode>(payload.mode);

  const {
    busy,
    mutating,
    asking,
    failure,
    retry,
    reserveResult,
    stale,
    needsSearch,
    runSearch,
    runArea,
    runDecide,
    discardPending,
    askToDecide,
    runNearby,
    runNearbyByHost,
    searchPlace,
    openInMaps,
    openExternal,
    askAboutShop,
    runStamp,
    runVisited,
    runForget,
    askToStamp,
    askToSignIn,
  } = useServerTools({
    app,
    capturePayload,
    onNotice,
    awaitContext,
    releaseSelection,
    onVisits,
    includeVisitedShops: payload.mode === "visited",
    trackCall,
    stampQueue,
  });

  /*
   * サインインしているか。
   *
   * **`visited` の有無で判断する。** サーバーは匿名のとき、この欄ごと落とす
   * （空の配列を入れない）ので、「1 軒も行っていない人」と混ざらない。
   */
  const signedIn = payload.visited !== undefined;
  const visitsAvailable = signedIn || app.capabilities.visitSignIn;
  const visitedIds = useMemo(() => new Set(payload.visited ?? []), [payload.visited]);

  // 「迷ったら」は「次の 3 軒を見る」で巡回する。payload に乗ってくる値を初期値にして、
  // ここで進める（サーバーが範囲外を丸めるので、増やし続けても壊れない）。
  const round = payload.decide?.round ?? 0;
  /*
   * いま効いているキーワード。モデルがキーワード付きで「迷ったら」を開いた
   * ときだけ入る。巡回や条件変更ではこれを保つ——落とすと母数が全国に広がり、
   * 無関係な店が「次の候補」として出る。
   * 他のモードの payload からは拾わない。検索フォームに残っていた語が
   * 見えないまま効いてしまうため。
   */
  const activeKeyword = payload.mode === "decide" ? payload.query.keyword : undefined;
  const wantsNear = payload.decide?.needsOrigin;

  // 広げられるのは地図だけ。他のモードでは畳む（釦がその画面に無いため）。
  const fullscreen = useFullscreen(hostContext, onDisplayMode, mode === "map");

  const { runConditions, searchArea, switchMode } = useModeSwitch({
    mode,
    setMode,
    form,
    payload,
    activeKeyword,
    onSelect,
    runSearch,
    onForm,
    runArea,
    runDecide,
    runNearby,
    runVisited,
    discardPending,
    signedIn,
  });

  // 現在地モードは基準地点が決まるまで結果を出さない
  // （直前のモードの payload が順位付きで残ってしまうため）。
  const awaitingOrigin = mode === "nearby" && payload.query.origin === undefined;

  const payloadReady = isPayloadReady(payload, mode, awaitingOrigin, stale);

  const heading = useMemo(
    () => buildHeading(mode, payload, payloadReady),
    [mode, payload, payloadReady],
  );

  const showResults = payloadReady && !awaitingOrigin;
  const shops = showResults ? payload.shops : [];
  const count = showResults ? formatCount(mode, payload.total, shops.length, payload.decide) : null;

  const inRoute = selected !== null && stops.some((s) => s.id === selected.id);

  /*
   * 順路は 1 度だけ組んで、パネルと地図に同じものを渡す。別々に組むと、
   * 参照が変わるたびに地図の線を引き直すことになる（結果は同じでも描き直す）。
   */
  const route = useMemo(() => planRoute(stops, routeOrigin), [stops, routeOrigin]);
  const routeShops = useMemo(() => route.legs.map((leg) => leg.shop), [route]);

  const detail = selected && (
    <SelectedShop
      report={
        <ReportEntry key={selected.id} enabled={app.capabilities.reports} shopId={selected.id} />
      }
      onAsk={supportedAction(app.capabilities.model, () => void askAboutShop(selected))}
      onOpenMap={() => openInMaps(selected)}
      onClear={() => onSelect(null)}
      asking={asking}
      inRoute={inRoute}
      routeFull={!inRoute && stops.length >= MAX_STOPS}
      onToggleRoute={() =>
        inRoute ? onRemoveStop(selected) : onAddStop(selected, payload.query.origin)
      }
      signedIn={signedIn}
      isVisited={visitedIds.has(selected.id)}
      // 匿名のときは記録ではなく、チャットへの依頼（UI から呼ぶと 401 で何も出ない）。
      onToggleVisit={supportedAction(visitsAvailable, () =>
        signedIn
          ? void runStamp(selected.id, !visitedIds.has(selected.id))
          : void askToStamp(selected),
      )}
    />
  );

  const controls = (
    <ModeControls
      mode={mode}
      prefectures={payload.prefectures}
      form={form}
      onForm={onForm}
      onSubmit={runConditions}
      origin={payload.query.origin}
      onLocate={runNearby}
      onLocateByHost={runNearbyByHost}
      onSearchPlace={searchPlace}
      notice={notice}
      busy={busy}
      onIssue={issueWith(payload.query.origin, activeKeyword, runDecide, reserveResult)}
      onOpenMap={() => switchMode("map")}
      wantsNear={wantsNear}
      compact={Hero === undefined}
      brands={payload.brands ?? []}
    />
  );
  /*
   * Web の地図は、絞り込みより先に出す（#125）。最初の画面で「近くにこれだけある」が
   * 見えるように。並びは DOM で入れ替える（CSS の order だと、読み上げと Tab の順が
   * 見た目とずれる）。会話の中（MCP）は従来どおり条件が先。
   */
  const placed = placeControls(Hero, mode, controls);
  const head = pageHead(Hero, mode, heading, count);
  const results = (
    <>
      {/* 詳細は選んだカードの直下に出す。一覧の上に置くと、選んだ瞬間に
          一覧が下にずれて、続けて別の店を押せない。 */}
      <Results
        mode={mode}
        payload={payload}
        ready={payloadReady}
        needsSearch={needsSearch}
        shops={shops}
        keyword={activeKeyword}
        onClearKeyword={() => runDecide(form, payload.query.origin, 0, undefined, wantsNear)}
        selected={selected}
        onSelect={onSelect}
        onAsk={supportedAction(
          app.capabilities.model,
          (picks: Shop[], basis: string) => void askToDecide(picks, basis, payload.decide),
        )}
        onReroll={() => runDecide(form, payload.query.origin, round + 1, activeKeyword)}
        asking={asking}
        busy={busy}
        detail={detail}
        route={routeShops}
        routeOrigin={routeOrigin}
        fullscreen={fullscreen}
        onSearchArea={searchArea}
        signedIn={signedIn}
        visitedIds={visitedIds}
        onForget={runForget}
        onSignIn={supportedAction(app.capabilities.visitSignIn, () => void askToSignIn())}
        belowMap={placed.belowMap}
        aside={placed.aside}
        decideTitle={head.decideTitle}
        onRetry={retry}
        failure={failure}
        reports={app.capabilities.reports === true}
      />
      {placed.after}
    </>
  );

  return (
    <main
      className={styles.main}
      style={safeAreaStyle(hostContext?.safeAreaInsets)}
      data-pending-calls={pendingCalls}
      data-busy={busy}
      data-tool-result-ready={resultReceived}
      data-mode={mode}
    >
      <AppHeader h1={head.h1} count={head.count} />

      <ModeTabs
        mode={mode}
        onChange={switchMode}
        mutating={mutating}
        visitsAvailable={visitsAvailable}
        primaryMode={primaryMode}
        variant={Hero ? "links" : "tabs"}
      />
      <ModePanel mode={mode} tabs={!Hero}>
        {placed.hero}
        {placed.top}
        {results}
      </ModePanel>

      {/*
       * 「家系とは」は結果の下。最初の画面は約束と地図に譲り、初めての人が
       * 開ける場所に置く（消さない）。
       */}
      {introduction}

      {/* 結果の下、注記の上。モードを切り替えても残るので、組み立てたものが消えない。 */}
      <ReportEntry enabled={app.capabilities.reports} ready={showResults} />
      <RoutePanel
        route={route}
        origin={routeOrigin}
        onRemove={onRemoveStop}
        onClear={onClearStops}
        onOpenLink={openExternal}
      />

      <footer className={styles.footer}>
        {/* 但し書きは結果の下に 1 回（#152）。ここは出典だけ見せ、説明は畳む。 */}
        <p className={styles.footnote}>{DATA_CREDIT}</p>
        <details className={styles.guide}>
          <summary className={styles.guideSummary}>データについて</summary>
          <ul className={styles.definitions}>
            {[DATA_FOOTNOTE, ...DATA_DEFINITIONS].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      </footer>
    </main>
  );
}
