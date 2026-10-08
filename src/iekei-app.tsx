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
  useRef,
  useState,
  type ComponentType,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import { StateNote } from "./components/StateNote";
import type { FormValues } from "./components/SearchForm";
import { createStampQueue } from "./hooks/use-server-tools";
import { IekeiAppInner } from "./iekei-app-inner";
import { useKeyboardFocusReturn, useResultAnnouncement } from "./hooks/use-result-handoff";
import { createDeliveryQueue } from "./lib/model-context";
import { EMPTY_PAYLOAD } from "./lib/payload";
import { MAX_STOPS } from "./lib/route";
import type { AppPayload, Origin, SearchMode, Shop, VisitResult } from "./lib/types";
import styles from "./mcp-app.module.css";

import type { HostConnectionProps, UiHost } from "./hosts/types";

export interface PresentationProps {
  introduction?: ReactNode;
  /**
   * 見出しの上に置く最初の画面（Web だけ）。入口のボタンからモードを切り替えるので、
   * 切り替えの口を受け取る部品を渡す。
   */
  hero?: ComponentType;
  primaryMode?: SearchMode;
}

export function IekeiApp({
  Connection,
  introduction,
  hero,
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

  // 下書きは結果による再マウントをまたいで保持する。
  const [form, setForm] = useState<FormValues>(() => initialForm(EMPTY_PAYLOAD.query));
  const draftRevision = useRef(0);
  const hostRevision = useRef(0);
  const onForm = useCallback((next: FormValues) => {
    draftRevision.current += 1;
    setForm(next);
  }, []);

  const replacePayload = useCallback((next: AppPayload) => {
    setPayload(next);
    setPayloadVersion((v) => v + 1);
    setSelected(null);
  }, []);

  // ホストから届く新しい検索条件は、未送信の下書きより優先する。
  const applyPayload = useCallback(
    (next: AppPayload) => {
      hostRevision.current += 1;
      setForm(initialForm(next.query));
      replacePayload(next);
    },
    [replacePayload],
  );

  // UI 呼び出しの開始時点を記録し、その後の入力を古い応答で上書きしない。
  const capturePayload = useCallback(() => {
    const draftAtStart = draftRevision.current;
    const hostAtStart = hostRevision.current;
    return (next: AppPayload) => {
      if (hostRevision.current !== hostAtStart) return false;
      // 条件が違う結果を下書きの隣に出さず、再検索まで既存の stale を維持する。
      // 券売機（decide）も同じ。発券の後にキーを押し直したら、古い発券の結果で
      // 選び直したキーを戻さない（#144。キーは次の発券の条件を選ぶだけ）。
      if (
        (next.mode === "form" || next.mode === "decide") &&
        draftRevision.current !== draftAtStart
      )
        return false;
      setForm(initialForm(next.query));
      replacePayload(next);
      return true;
    };
  }, [replacePayload]);

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

  // 作り直しのあとの焦点と読み上げ。作り直されないここで持つ（src/hooks/use-result-handoff.ts）。
  useKeyboardFocusReturn();
  const announcer = useResultAnnouncement(payloadVersion, payload);

  return (
    <Connection onPayload={applyPayload} onContextChange={onContextChange}>
      {({ host, error }) =>
        /*
         * 接続前・接続エラーも、接続後と同じ .main の中に描く。余白（セーフエリアを含む）が
         * 揃わないと、つながった瞬間に舞台が画面の端から内側へ跳ぶ。
         */
        error ? (
          // Web の下のリンクの位置を、この画面だけ詰める目印（src/web.css・#153）。
          <main className={styles.main} data-connection="failed">
            <HeroSlot Hero={hero} />
            <StateNote
              kind="error"
              action={{ label: "再読み込み", onClick: () => window.location.reload() }}
            >
              {`接続できませんでした。${error.message}`}
            </StateNote>
          </main>
        ) : !host ? (
          <main className={styles.main}>
            <HeroSlot Hero={hero} />
            <StateNote kind="loading">読み込み中…</StateNote>
          </main>
        ) : (
          <>
            <IekeiAppConnected
              introduction={introduction}
              hero={hero}
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
              form={form}
              onForm={onForm}
              capturePayload={capturePayload}
              pendingCalls={pendingCalls}
              trackCall={trackCall}
              hostContextPatch={hostContextPatch}
              onContextChange={onContextChange}
            />
            <p role="status" className={styles.visuallyHidden} ref={announcer} />
          </>
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
  form: FormValues;
  onForm: (form: FormValues) => void;
  capturePayload: () => (payload: AppPayload) => boolean;
  pendingCalls: number;
  trackCall: (delta: 1 | -1) => void;
  hostContextPatch: McpUiHostContext | undefined;
  onContextChange: (context: McpUiHostContext) => void;
}

function IekeiAppConnected({
  introduction,
  hero,
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
  form,
  onForm,
  capturePayload,
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
  // 「行った」の列も、結果ごとの作り直しをまたいで 1 本にする（#171）。
  const [stampQueue] = useState(createStampQueue);

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
      hero={hero}
      primaryMode={primaryMode}
      app={app}
      payload={payload ?? EMPTY_PAYLOAD}
      resultReceived={payload !== null}
      form={form}
      onForm={onForm}
      capturePayload={capturePayload}
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
      stampQueue={stampQueue}
      awaitContext={awaitContext}
      releaseSelection={releaseSelection}
      onDisplayMode={requestDisplayMode}
      // 初期値はホストから直接読み、以降の変更分を上書きする。
      hostContext={{ ...app.getHostContext(), ...hostContextPatch }}
    />
  );
}

/** tool の引数を、検索フォームの初期値に写す。 */
function initialForm(query: AppPayload["query"]): FormValues {
  return {
    prefecture: query.prefecture ?? "",
    taste: query.taste && query.taste !== "unknown" ? query.taste : "",
    keyword: query.keyword ?? "",
  };
}

/**
 * 最初の画面の差し込み口。Web だけが部品を渡す。go が無い（接続前）ときは、
 * 入口のボタンを押せない形で先に出す。約束は接続を待たずに見せる（#125）。
 */
function HeroSlot({ Hero }: { Hero?: PresentationProps["hero"] }) {
  return Hero ? <Hero /> : null;
}
