/**
 * 家系ラーメンを探す MCP Apps。
 *
 * 3 モードを 1 つの UI にまとめている:
 *   form    検索フォームで絞り込む
 *   nearby  現在地（または地名）から近い順に 5 件
 *   map     日本地図にプロット
 *
 * 絞り込みは UI 内で完結させず、毎回サーバーの tool を呼び直す。
 * そうするとモデル側にも結果が渡り、会話を続けられる。
 *
 * 選択した 1 軒も同じ考えで、updateModelContext でモデルに渡している。
 * これが無いと、地図で店を選んだ直後に「この店は？」と聞かれてもモデルは
 * 何も知らず、UI と会話が別々のものに見える。
 */
import type { McpUiDisplayMode, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import { ModeControls } from "./components/ModeControls";
import { ModeTabs } from "./components/ModeTabs";
import type { FormValues } from "./components/SearchForm";
import { Results } from "./components/Results";
import { RoutePanel } from "./components/RoutePanel";
import { SelectedShop } from "./components/SelectedShop";
import { useFullscreen } from "./hooks/use-fullscreen";
import { useModeSwitch } from "./hooks/use-mode-switch";
import { useServerTools } from "./hooks/use-server-tools";
import { originLabel } from "./lib/geo";
import { createDeliveryQueue } from "./lib/model-context";
import { EMPTY_PAYLOAD } from "./lib/payload";
import { safeAreaStyle } from "./lib/safe-area";
import { DATA_FOOTNOTE } from "./lib/data-caveats";
import { scopeLabel } from "./lib/scope";
import { MAX_STOPS, planRoute } from "./lib/route";
import type { AppPayload, Origin, SearchMode, Shop, VisitResult } from "./lib/types";
import styles from "./mcp-app.module.css";
import type { HostConnectionProps, UiHost } from "./hosts/types";

interface PresentationProps {
  introduction?: ReactNode;
  primaryMode?: SearchMode;
}

export function IekeiApp({
  Connection,
  introduction,
  primaryMode,
}: { Connection: ComponentType<HostConnectionProps> } & PresentationProps) {
  const [payload, setPayload] = useState<AppPayload | null>(null);
  // payload が差し替わるたびに増える。Inner の key にして状態を初期化する。
  const [payloadVersion, setPayloadVersion] = useState(0);
  /**
   * 返ってきていない呼び出しの数。画面の `data-pending-calls` に出す。
   *
   * **E2E が「古い応答の反映まで済んだ」ことを知る合図。** 遅らせた応答で
   * 引き戻されないことを確かめるとき、届いてから時間で待つと、混んだ CI では
   * 反映が終わる前に確かめて何も見ずに通る。反映と同じ描画で減るので、0 に
   * なった画面には、その応答で起きることがすべて出ている。Inner は payload ごとに
   * 作り直されるので、数はここで持つ。
   */
  const [pendingCalls, setPendingCalls] = useState(0);
  const trackCall = useCallback((delta: 1 | -1) => setPendingCalls((n) => n + delta), []);
  const [hostContextPatch, setHostContextPatch] = useState<McpUiHostContext | undefined>();
  /**
   * 位置情報が取れなかったときの案内。
   * Inner は payload ごとに key で作り直されるため、内部 state に置くと
   * 検索結果の反映と同時に消えてしまう。ここで保持する。
   */
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * 選択中の店。Inner は payload ごとに作り直されるので、ここで持つ。
   * 検索し直したら選択は解除する（結果に含まれない店が選ばれたままになるため）。
   */
  const [selected, setSelected] = useState<Shop | null>(null);
  /**
   * 「まわる店」に入れた店。
   *
   * **検索し直しても消さない。** 別の条件で見つけた店を足していくものなので、
   * payload が変わるたびに空にすると組み立てられない。
   * 選択（1 軒）とは寿命が違うので、別の state で持つ。
   */
  const [stops, setStops] = useState<Shop[]>([]);
  /**
   * 順路の出発点。
   *
   * **今の payload から取らない。** 入れた店は検索をまたいで残るのに出発点だけ
   * payload 由来にすると、基準地点を持たないモード（検索フォーム・地図）へ
   * 移った瞬間に消える。順路が並べ替わり、1 軒目の距離も消え、地図アプリにも
   * 現在地から引かせることになる——ユーザーは何も操作していないのに。
   *
   * 最初の 1 軒を入れたときの基準地点を、空になるまで持ち続ける。
   */
  const [routeOrigin, setRouteOrigin] = useState<Origin | undefined>();

  /**
   * 訪問記録だけを差し替える。
   *
   * **payload ごと入れ替えない。** スタンプの結果は mode: "visited" で返るので、
   * applyPayload に通すと Inner が key ごと作り直され、検索結果を見ていた人が
   * 「行った店」の画面へ飛ばされる（選んでいた店も外れる）。押したのは
   * 「行った」だけなので、変わるのは記録だけにする。
   */

  const applyPayload = useCallback((next: AppPayload) => {
    setPayload(next);
    setPayloadVersion((v) => v + 1);
    setSelected(null);
  }, []);

  /**
   * 店を入れる。
   *
   * **出発点は「空から 1 軒目」の瞬間にだけ決める。** 未設定なら拾う、という
   * 書き方（`prev ?? origin`）にすると、出発点の無い旅程に別の場所で探した店を
   * 足したとき、その検索の基準地点が後付けされる。1 軒目が押し出され、順番も
   * 距離も変わる（実測: 「せい家・ここから出発」が「壱八家・横浜駅から 239m →
   * せい家・11.5km」になった）。あとから足した店の検索条件で、すでに組んだ
   * 旅程が書き換わってはいけない。
   */
  const addStop = useCallback(
    (shop: Shop, origin?: Origin) => {
      // ボタン側でも押せなくしてあるが、ここでも止める。上限の判断を
      // 画面側だけに置くと、別の経路から足せてしまう。
      if (stops.some((s) => s.id === shop.id) || stops.length >= MAX_STOPS) return;
      if (stops.length === 0) setRouteOrigin(origin);
      setStops([...stops, shop]);
    },
    [stops],
  );

  /** 店を外す。空になったら出発点も忘れる（次の旅程は別物）。 */
  const removeStop = useCallback(
    (shop: Shop) => {
      const next = stops.filter((s) => s.id !== shop.id);
      setStops(next);
      if (next.length === 0) setRouteOrigin(undefined);
    },
    [stops],
  );

  const clearStops = useCallback(() => {
    setStops([]);
    setRouteOrigin(undefined);
  }, []);

  const onContextChange = useCallback((params: McpUiHostContext) => {
    setHostContextPatch((prev) => ({ ...prev, ...params }));
  }, []);

  return (
    <Connection onPayload={applyPayload} onContextChange={onContextChange}>
      {({ host, error }) =>
        error ? (
          <p className={styles.error}>接続エラー: {error.message}</p>
        ) : !host ? (
          <p className={styles.status}>読み込み中…</p>
        ) : (
          <IekeiAppConnected
            introduction={introduction}
            primaryMode={primaryMode}
            app={host}
            payload={payload}
            payloadVersion={payloadVersion}
            setPayload={setPayload}
            notice={notice}
            setNotice={setNotice}
            selected={selected}
            setSelected={setSelected}
            stops={stops}
            routeOrigin={routeOrigin}
            addStop={addStop}
            removeStop={removeStop}
            clearStops={clearStops}
            applyPayload={applyPayload}
            pendingCalls={pendingCalls}
            trackCall={trackCall}
            hostContextPatch={hostContextPatch}
            onContextChange={onContextChange}
          />
        )
      }
    </Connection>
  );
}

interface ConnectedProps extends PresentationProps {
  app: UiHost;
  payload: AppPayload | null;
  payloadVersion: number;
  setPayload: Dispatch<SetStateAction<AppPayload | null>>;
  notice: string | null;
  setNotice: (notice: string | null) => void;
  selected: Shop | null;
  setSelected: (shop: Shop | null) => void;
  stops: Shop[];
  routeOrigin: Origin | undefined;
  addStop: (shop: Shop, origin?: Origin) => void;
  removeStop: (shop: Shop) => void;
  clearStops: () => void;
  applyPayload: (payload: AppPayload) => void;
  pendingCalls: number;
  trackCall: (delta: 1 | -1) => void;
  hostContextPatch: McpUiHostContext | undefined;
  onContextChange: (context: McpUiHostContext) => void;
}

function IekeiAppConnected({
  introduction,
  primaryMode,
  app,
  payload,
  payloadVersion,
  setPayload,
  notice,
  setNotice,
  selected,
  setSelected,
  stops,
  routeOrigin,
  addStop,
  removeStop,
  clearStops,
  applyPayload,
  pendingCalls,
  trackCall,
  hostContextPatch,
  onContextChange,
}: ConnectedProps) {
  /**
   * 選択をモデルに渡す列。ホストは次のユーザー発話までこれを溜めておくので、
   * 「この店について聞く」を押した時点では店の詳細が揃っている。
   * 空の content は「渡したものを消す」の意味になる。
   */
  // 1 度だけ作る。毎レンダーで作り直すと、列も記録も分かれて順番の約束が崩れる。
  const [queue] = useState(createDeliveryQueue);

  /**
   * 受け渡しを積む。effect からも、失敗した解除のやり直しからも、ここを通す。
   * 片方で別に組むと列が分かれて、完了順の入れ替わりが戻ってくる。
   */
  const enqueueDelivery = useCallback(
    (shop: Shop | null): Promise<boolean> =>
      app.capabilities.model ? queue.enqueue(app, shop) : Promise.resolve(false),
    [app, queue],
  );

  useEffect(() => {
    if (!app.capabilities.model) return;
    // 渡したものも、列に並んでいるものも無いなら、消しに行く必要はない
    // （起動直後の無駄な往復を避ける）。並んでいる分まで見ないと、送信中に
    // 選択を外したときに消し忘れ、ホストがその店を持ったままになる。
    if (!selected && queue.isEmpty()) return;

    // すでに同じ状態を積んである（解除のやり直しが先に積んだ場合など）。
    // もう一度積むと、同じ内容の往復が 2 回走る。
    if (queue.hasQueued(selected?.id ?? null)) return;

    void enqueueDelivery(selected);
  }, [app, enqueueDelivery, queue, selected]);

  /** 選択を外し、モデル側から消えるまで待つ。 */
  const releaseSelection = useCallback(() => {
    // すでに空。送るものも待つものも無い。
    if (queue.isEmpty()) {
      setSelected(null);
      return Promise.resolve(true);
    }
    /*
     * 選択がすでに null なら selected は変わらず、effect は走らない。前回の
     * 解除が失敗していてホストが店を持ったままでも、誰も消しに行かなくなる。
     * ここで直接積んで、もう一度消しに行かせる。
     */
    const done = enqueueDelivery(null);
    setSelected(null);
    return done;
  }, [enqueueDelivery, queue, setSelected]);

  /**
   * いまの画面と選択。**応答が返るまでに変わりうるので、掴んだ値を使わない。**
   * 毎レンダーの後に写す（依存を書かないのは、写し忘れを作らないため）。
   */
  const latest = useRef({ mode: payload?.mode, selected });
  useEffect(() => {
    latest.current = { mode: payload?.mode, selected };
  });

  /**
   * 記録の更新を反映する。
   *
   * **payload ごと入れ替えない。** スタンプの結果は mode: "visited" で返るので、
   * applyPayload に通すと Inner が key ごと作り直され、検索結果を見ていた人が
   * 「行った店」の画面へ飛ばされる（選んでいた店も外れる）。押したのは
   * 「行った」だけなので、変わるのは記録だけにする。
   */
  const applyVisits = useCallback(
    (next: VisitResult) => {
      setPayload((prev) => {
        if (!prev) return prev;
        const records = { visited: next.visited, progress: next.progress };
        /*
         * **「行った店」の画面だけは一覧も差し替える。** この画面の中身は記録
         * そのものなので、記録だけ更新すると、取り消した店がカードとして残り
         * 「行った」釦付きで並ぶ（Codex の指摘で気付いた）。検索結果の画面では
         * 逆に一覧を触らない——押したのは「行った」だけで、探していた条件は
         * 変わっていない。
         */
        if (prev.mode !== "visited" || !("shops" in next)) return { ...prev, ...records };
        return { ...prev, ...records, shops: next.shops, total: next.total };
      });

      /*
       * 一覧から消えた店を選んだままにしない。
       *
       * 詳細（と「選択を解除」）はカードの直下にしか無いので、カードごと消えると
       * **モデルには渡したまま、画面からは外せない**状態になる。検索結果の画面では
       * カードが残るので、ここで手放すのは「行った店」の画面だけ。
       *
       * **いまの選択を ref から読む。** 応答を待つ間にも別の店は選べるので、
       * 呼んだ時点の値を掴んだままだと、返事が届いたときに**いま選んでいる別の店**を
       * 消してしまう（Codex の指摘で気付いた）。
       */
      const { mode, selected: current } = latest.current;
      if (
        mode === "visited" &&
        current &&
        "shops" in next &&
        !next.shops.some((shop) => shop.id === current.id)
      ) {
        void releaseSelection();
      }
    },
    [releaseSelection, setPayload],
  );

  /**
   * この店の詳細がモデルに届いているか。
   * 届かないまま質問だけ送るとモデルは店名しか知らないまま答えるので、
   * 「聞く」側がこれを待って判断する。
   */
  const awaitContext = useCallback((shop: Shop) => queue.hasDelivered(shop.id), [queue]);

  /**
   * 表示モードの切り替え。
   *
   * **返ってきた mode を正とする。** ホストは要求と違うモードを返すことがあり
   * （使えないモードを頼んだときなど）、要求した側の値で画面を組むと、
   * 全画面になっていないのに「元に戻す」が出る。
   *
   * ホストは host-context-changed でも知らせてくるが、送ってこないホストが
   * あっても釦の表示がずれないよう、戻り値でも同じ場所を更新しておく。
   */
  const requestDisplayMode = useCallback(
    async (mode: McpUiDisplayMode) => {
      if (!app) return;
      const result = await app.requestDisplayMode({ mode });
      onContextChange({ displayMode: result.mode });
    },
    [app, onContextChange],
  );

  return (
    <IekeiAppInner
      key={payloadVersion}
      introduction={introduction}
      primaryMode={primaryMode}
      app={app}
      payload={payload ?? EMPTY_PAYLOAD}
      resultReceived={payload !== null}
      onPayload={applyPayload}
      notice={notice}
      onNotice={setNotice}
      selected={selected}
      onSelect={setSelected}
      stops={stops}
      routeOrigin={routeOrigin}
      onAddStop={addStop}
      onRemoveStop={removeStop}
      onClearStops={clearStops}
      onVisits={applyVisits}
      pendingCalls={pendingCalls}
      trackCall={trackCall}
      awaitContext={awaitContext}
      releaseSelection={releaseSelection}
      onDisplayMode={requestDisplayMode}
      // 初期値はホストから直接読み、以降の変更分を上書きする。
      hostContext={{ ...app.getHostContext(), ...hostContextPatch }}
    />
  );
}

/** 「558 件（200 件表示）」。上限で切られているときだけ内訳を出す。 */
/** tool の引数を、検索フォームの初期値に写す。 */
function initialForm(query: AppPayload["query"]): FormValues {
  return {
    prefecture: query.prefecture ?? "",
    taste: query.taste && query.taste !== "unknown" ? query.taste : "",
    keyword: query.keyword ?? "",
  };
}

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
function buildHeading(mode: SearchMode, payload: AppPayload, ready: boolean): string {
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

function formatCount(total: number, shown: number): string {
  return total > shown ? `${total} 件（${shown} 件表示）` : `${total} 件`;
}

interface InnerProps extends PresentationProps {
  app: UiHost;
  payload: AppPayload;
  resultReceived: boolean;
  onPayload: (payload: AppPayload) => void;
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
 * payload ごとに key で作り直されるので、状態は props からそのまま初期化できる。
 * tool 結果が届くたびにモード・フォーム・選択状態が新しい payload に揃う。
 */
function IekeiAppInner({
  introduction,
  primaryMode,
  app,
  payload,
  resultReceived,
  onPayload,
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
  awaitContext,
  releaseSelection,
  onDisplayMode,
  hostContext,
}: InnerProps) {
  // payload が変わるたび key で作り直されるので、ここは「初期値を 1 度だけ写す」形。
  // 再同期しないことが前提なので、派生 state の警告はこの 2 つに限って外している。
  // react-doctor-disable-next-line react-doctor/no-derived-useState
  const [mode, setMode] = useState<SearchMode>(payload.mode);
  const [form, setForm] = useState<FormValues>(() => initialForm(payload.query));

  const {
    busy,
    mutating,
    asking,
    failure,
    stale,
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
    onPayload,
    onNotice,
    awaitContext,
    releaseSelection,
    onVisits,
    includeVisitedShops: payload.mode === "visited",
    trackCall,
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

  // 「迷ったら」は「別の候補を見る」で巡回する。payload に乗ってくる値を初期値にして、
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

  // 広げられるのは地図だけ。他のモードでは畳む（釦がその画面に無いため）。
  const fullscreen = useFullscreen(hostContext, onDisplayMode, mode === "map");

  const { runConditions, searchArea, switchMode } = useModeSwitch({
    mode,
    setMode,
    form,
    origin: payload.query.origin,
    activeKeyword,
    onSelect,
    runSearch,
    bounds: payload.query.bounds,
    prefecture: payload.query.prefecture,
    onForm: setForm,
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

  /*
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
  const payloadReady = (payload.mode === mode || awaitingOrigin) && !stale;

  const heading = useMemo(
    () => buildHeading(mode, payload, payloadReady),
    [mode, payload, payloadReady],
  );

  const showResults = payloadReady && !awaitingOrigin;
  const shops = showResults ? payload.shops : [];
  const count = showResults ? formatCount(payload.total, shops.length) : null;

  const inRoute = selected !== null && stops.some((s) => s.id === selected.id);

  /*
   * 順路は 1 度だけ組んで、パネルと地図に同じものを渡す。別々に組むと、
   * 参照が変わるたびに地図の線を引き直すことになる（結果は同じでも描き直す）。
   */
  const route = useMemo(() => planRoute(stops, routeOrigin), [stops, routeOrigin]);
  const routeShops = useMemo(() => route.legs.map((leg) => leg.shop), [route]);

  const detail = selected && (
    <SelectedShop
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
      /*
       * 匿名のときは記録ではなく、チャットへの依頼になる。UI から呼んでも
       * 401 でホストは何も出さないので、モデルに呼んでもらう。
       */
      onToggleVisit={supportedAction(visitsAvailable, () =>
        signedIn
          ? void runStamp(selected.id, !visitedIds.has(selected.id))
          : void askToStamp(selected),
      )}
    />
  );

  return (
    <main
      className={styles.main}
      style={safeAreaStyle(hostContext?.safeAreaInsets)}
      data-pending-calls={pendingCalls}
      data-tool-result-ready={resultReceived}
      data-mode={mode}
    >
      <div className={styles.header}>
        <div className={styles.headerMain}>
          {/* 丼は飾りなので、見出しの読み上げには載せない。 */}
          <span className={styles.brandMark} aria-hidden="true">
            🍜
          </span>
          <h1 className={styles.title}>{heading}</h1>
        </div>
        {count ? <span className={styles.count}>{count}</span> : null}
      </div>

      {introduction}

      <ModeTabs
        mode={mode}
        onChange={switchMode}
        mutating={mutating}
        visitsAvailable={visitsAvailable}
        primaryMode={primaryMode}
      />

      <ModeControls
        mode={mode}
        prefectures={payload.prefectures}
        form={form}
        onForm={setForm}
        onSubmit={runConditions}
        origin={payload.query.origin}
        onLocate={runNearby}
        onLocateByHost={runNearbyByHost}
        onSearchPlace={searchPlace}
        notice={notice}
        busy={busy}
      />

      {failure && <p className={styles.error}>{failure}</p>}

      {/* 詳細は選んだカードの直下に出す。一覧の上に置くと、選んだ瞬間に
          一覧が下にずれて、続けて別の店を押せない。 */}
      <Results
        mode={mode}
        payload={payload}
        ready={payloadReady}
        shops={shops}
        keyword={activeKeyword}
        onClearKeyword={() => runDecide(form, payload.query.origin, 0)}
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
      />

      {/* 結果の下、注記の上。モードを切り替えても残るので、組み立てたものが消えない。 */}
      <RoutePanel
        route={route}
        origin={routeOrigin}
        onRemove={onRemoveStop}
        onClear={onClearStops}
        onOpenLink={openExternal}
      />

      <p className={styles.footnote}>{DATA_FOOTNOTE}</p>
    </main>
  );
}
