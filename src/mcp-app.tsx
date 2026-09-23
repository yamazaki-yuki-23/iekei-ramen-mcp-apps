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
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ModeControls } from "./components/ModeControls";
import { ModeTabs } from "./components/ModeTabs";
import type { FormValues } from "./components/SearchForm";
import { Results } from "./components/Results";
import { SelectedShop } from "./components/SelectedShop";
import { useModeSwitch } from "./hooks/use-mode-switch";
import { useServerTools } from "./hooks/use-server-tools";
import { originLabel } from "./lib/geo";
import { createDeliveryQueue } from "./lib/model-context";
import { EMPTY_PAYLOAD, readPayload } from "./lib/payload";
import type { AppPayload, SearchMode, Shop } from "./lib/types";
import styles from "./mcp-app.module.css";

/* 和文は 1 文を 1 本の文字列にする（JSX の改行は空白 1 個に畳まれる）。 */
const FOOTNOTE =
  "店舗データは OpenStreetMap（ODbL）由来。「家系の可能性」は店名から家系と推定したもの、「家系か未判定」は店名だけでは判断できなかったものです。味の傾向は既知のブランドから割り当てた参考値で、多くの店舗は「情報なし」になります。営業時間は変わることがあるため訪問前にご確認ください。";

function IekeiApp() {
  const [payload, setPayload] = useState<AppPayload | null>(null);
  // payload が差し替わるたびに増える。Inner の key にして状態を初期化する。
  const [payloadVersion, setPayloadVersion] = useState(0);
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

  const applyPayload = useCallback((next: AppPayload) => {
    setPayload(next);
    setPayloadVersion((v) => v + 1);
    setSelected(null);
  }, []);

  const { app, error } = useApp({
    appInfo: { name: "Iekei Ramen Finder", version: "0.1.0" },
    capabilities: {},
    onAppCreated: (instance) => {
      instance.ontoolresult = async (result) => {
        const next = readPayload(result);
        if (next) applyPayload(next);
      };
      instance.onhostcontextchanged = (params) =>
        setHostContextPatch((prev) => ({ ...prev, ...params }));
      instance.onerror = console.error;
      instance.onteardown = async () => ({});
    },
  });

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
      app ? queue.enqueue(app, shop) : Promise.resolve(false),
    [app, queue],
  );

  useEffect(() => {
    if (!app) return;
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
  }, [enqueueDelivery, queue]);

  /**
   * この店の詳細がモデルに届いているか。
   * 届かないまま質問だけ送るとモデルは店名しか知らないまま答えるので、
   * 「聞く」側がこれを待って判断する。
   */
  const awaitContext = useCallback((shop: Shop) => queue.hasDelivered(shop.id), [queue]);

  if (error) {
    return <p className={styles.error}>接続エラー: {error.message}</p>;
  }
  if (!app) {
    return <p className={styles.status}>読み込み中…</p>;
  }
  return (
    <IekeiAppInner
      key={payloadVersion}
      app={app}
      payload={payload ?? EMPTY_PAYLOAD}
      onPayload={applyPayload}
      notice={notice}
      onNotice={setNotice}
      selected={selected}
      onSelect={setSelected}
      awaitContext={awaitContext}
      releaseSelection={releaseSelection}
      // 初期値はホストから直接読み、以降の変更分を上書きする。
      hostContext={{ ...app.getHostContext(), ...hostContextPatch }}
    />
  );
}

/** ホストが指定する画面端の余白。渡してこないホストもある。 */
function safeAreaPadding(hostContext?: McpUiHostContext) {
  const inset = hostContext?.safeAreaInsets;
  return {
    paddingTop: inset?.top,
    paddingRight: inset?.right,
    paddingBottom: inset?.bottom,
    paddingLeft: inset?.left,
  };
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
};

/**
 * 見出しの文。
 *
 * 結果が揃う前は、前のモードの件数や条件を名乗らない（切り替えに失敗すると
 * 「迷ったらこの 558 軒（全国）」のような嘘の見出しが残る）。
 */
function buildHeading(mode: SearchMode, payload: AppPayload, ready: boolean): string {
  if (!ready) return HEADING_BY_MODE[mode];
  if (mode === "nearby") {
    return payload.query.origin
      ? `${originLabel(payload.query.origin)}の近くの家系ラーメン`
      : HEADING_BY_MODE.nearby;
  }
  const where = payload.query.prefecture ?? "全国";
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

interface InnerProps {
  app: App;
  payload: AppPayload;
  onPayload: (payload: AppPayload) => void;
  /** 再マウントをまたいで残る案内メッセージ。 */
  notice: string | null;
  onNotice: (notice: string | null) => void;
  /** 選択中の店。モデルに渡す都合で外側が持つ。 */
  selected: Shop | null;
  onSelect: (shop: Shop | null) => void;
  /** その店の詳細がモデルに届いたか。届いていなければ質問に詳細を同梱する。 */
  awaitContext: (shop: Shop) => Promise<boolean>;
  /** 選択を外し、モデル側から消えるまで待つ。 */
  releaseSelection: () => Promise<boolean>;
  hostContext?: McpUiHostContext;
}

/**
 * payload ごとに key で作り直されるので、状態は props からそのまま初期化できる。
 * tool 結果が届くたびにモード・フォーム・選択状態が新しい payload に揃う。
 */
function IekeiAppInner({
  app,
  payload,
  onPayload,
  notice,
  onNotice,
  selected,
  onSelect,
  awaitContext,
  releaseSelection,
  hostContext,
}: InnerProps) {
  // payload が変わるたび key で作り直されるので、ここは「初期値を 1 度だけ写す」形。
  // 再同期しないことが前提なので、派生 state の警告はこの 2 つに限って外している。
  // react-doctor-disable-next-line react-doctor/no-derived-useState
  const [mode, setMode] = useState<SearchMode>(payload.mode);
  const [form, setForm] = useState<FormValues>(() => initialForm(payload.query));

  const {
    busy,
    asking,
    failure,
    stale,
    runSearch,
    runDecide,
    askToDecide,
    runNearby,
    runNearbyByHost,
    geocode,
    openInMaps,
    askAboutShop,
  } = useServerTools({ app, onPayload, onNotice, awaitContext, releaseSelection });

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

  const { runConditions, switchMode } = useModeSwitch({
    mode,
    setMode,
    form,
    origin: payload.query.origin,
    activeKeyword,
    onSelect,
    runSearch,
    runDecide,
    runNearby,
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

  const detail = selected && (
    <SelectedShop
      onAsk={() => void askAboutShop(selected)}
      onOpenMap={() => openInMaps(selected)}
      onClear={() => onSelect(null)}
      asking={asking}
    />
  );

  return (
    <main className={styles.main} style={safeAreaPadding(hostContext)}>
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

      <ModeTabs mode={mode} onChange={switchMode} busy={busy} />

      <ModeControls
        mode={mode}
        prefectures={payload.prefectures}
        form={form}
        onForm={setForm}
        onSubmit={runConditions}
        origin={payload.query.origin}
        onLocate={runNearby}
        onLocateByHost={runNearbyByHost}
        onGeocode={geocode}
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
        onAsk={(picks, basis) => void askToDecide(picks, basis)}
        onReroll={() => runDecide(form, payload.query.origin, round + 1, activeKeyword)}
        asking={asking}
        busy={busy}
        detail={detail}
      />

      <p className={styles.footnote}>{FOOTNOTE}</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IekeiApp />
  </StrictMode>,
);
