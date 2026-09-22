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
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ModeTabs } from "./components/ModeTabs";
import { NearbyPanel } from "./components/NearbyPanel";
import { SearchForm, type FormValues } from "./components/SearchForm";
import { ResultView } from "./components/ResultView";
import { SelectedShop } from "./components/SelectedShop";
import { useServerTools } from "./hooks/use-server-tools";
import { EMPTY_PAYLOAD, readPayload } from "./lib/payload";
import { describeShop } from "./lib/shop-brief";
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
   * 選択をモデルに渡す。ホストは次のユーザー発話までこれを溜めておくので、
   * 「この店について聞く」を押した時点では店の詳細が揃っている。
   * 空の content は「渡したものを消す」の意味になる。
   */
  const context = useRef({
    /** ホストが今持っているか（成功が確定したものだけ数える）。 */
    delivered: false,
    /** 送信中・列に並んでいる受け渡しの数。これを見ないと消し忘れる。 */
    pending: 0,
  });
  /**
   * 直近の受け渡し。どの店を渡したかも持つ。
   *
   * 届かないまま質問だけ送るとモデルは店名しか知らないまま答えるので、
   * 「聞く」側がこれを待って判断する。待っている間に別の店へ移ることがあるため、
   * 店の id も突き合わせる。
   */
  const contextDelivered = useRef<{ shopId: string | null; done: Promise<boolean> }>({
    shopId: null,
    done: Promise.resolve(false),
  });
  /**
   * 受け渡しは 1 本の列にして順番に流す。
   *
   * 並行に投げると完了順が入れ替わる。古い受け渡しが遅れて失敗すると、その
   * 後始末が、先に成功していた新しい受け渡しを消してしまう。
   */
  const contextQueue = useRef<Promise<unknown> | null>(null);
  useEffect(() => {
    if (!app) return;
    // 渡したものも、列に並んでいるものも無いなら、消しに行く必要はない
    // （起動直後の無駄な往復を避ける）。並んでいる分まで見ないと、送信中に
    // 選択を外したときに消し忘れ、ホストがその店を持ったままになる。
    if (!selected && !context.current.delivered && context.current.pending === 0) return;

    context.current.pending += 1;

    // 対応していないホストでも UI は動かし続ける。失敗は質問側で吸収する。
    let settle: (delivered: boolean) => void = () => {};
    const done = new Promise<boolean>((resolve) => {
      settle = resolve;
    });

    contextQueue.current = (contextQueue.current ?? Promise.resolve()).then(async () => {
      try {
        await app.updateModelContext(
          selected
            ? {
                content: [{ type: "text", text: describeShop(selected) }],
                structuredContent: { selectedShop: selected },
              }
            : { content: [] },
        );
        context.current.delivered = selected !== null;
        settle(true);
      } catch {
        // 質問側は後始末を待たなくていい。
        settle(false);
        // 渡せなかったときは、ホストに残っている前の店を消しに行く。解除の失敗も
        // 差し替えの失敗もここを通る。残したままだと、ホストは古い店を持ち続け、
        // ユーザーが次に打った質問にその店が混ざる。差し替えの失敗なら、質問には
        // 新しい店の詳細が同梱されるので、古い店と食い違うことにもなる。
        try {
          await app.updateModelContext({ content: [] });
          context.current.delivered = false;
        } catch {
          // これも失敗したら delivered は触らない。前に渡したものが残っている
          // 可能性があるので、次の解除でまた消しに行く。
        }
      } finally {
        context.current.pending -= 1;
      }
    });

    contextDelivered.current = { shopId: selected?.id ?? null, done };
  }, [app, selected]);

  /**
   * この店の詳細がモデルに届いているか。
   * 待っている間に選択が変わっていたら、ホストが持っているのは別の店なので false。
   */
  const awaitContext = useCallback(async (shop: Shop) => {
    if (contextDelivered.current.shopId !== shop.id) return false;
    const ok = await contextDelivered.current.done;
    return ok && contextDelivered.current.shopId === shop.id;
  }, []);

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
  hostContext,
}: InnerProps) {
  // payload が変わるたび key で作り直されるので、ここは「初期値を 1 度だけ写す」形。
  // 再同期しないことが前提なので、派生 state の警告はこの 2 つに限って外している。
  // react-doctor-disable-next-line react-doctor/no-derived-useState
  const [mode, setMode] = useState<SearchMode>(payload.mode);
  const [form, setForm] = useState<FormValues>({
    prefecture: payload.query.prefecture ?? "",
    taste: payload.query.taste && payload.query.taste !== "unknown" ? payload.query.taste : "",
    keyword: payload.query.keyword ?? "",
  });

  const {
    busy,
    asking,
    failure,
    runSearch,
    runNearby,
    runNearbyByHost,
    geocode,
    openInMaps,
    askAboutShop,
  } = useServerTools({ app, onPayload, onNotice, awaitContext });

  const switchMode = useCallback(
    (next: SearchMode) => {
      setMode(next);
      onSelect(null);
      if (next === "form" || next === "map") runSearch(form, next);
    },
    [form, onSelect, runSearch],
  );

  // 現在地モードは基準地点が決まるまで結果を出さない
  // （直前のモードの payload が順位付きで残ってしまうため）。
  const awaitingOrigin = mode === "nearby" && payload.query.origin === undefined;

  const heading = useMemo(() => {
    if (mode === "nearby") {
      return payload.query.origin
        ? `${payload.query.origin.label ?? "現在地"}の近くの家系ラーメン`
        : "現在地から家系ラーメンを探す";
    }
    return `${payload.query.prefecture ?? "全国"}の家系ラーメン`;
  }, [mode, payload.query]);

  const shops = awaitingOrigin ? [] : payload.shops;
  const count = awaitingOrigin ? null : formatCount(payload.total, shops.length);

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

      {mode === "form" && (
        <SearchForm
          prefectures={payload.prefectures}
          values={form}
          onChange={setForm}
          onSubmit={() => runSearch(form, "form")}
          busy={busy}
        />
      )}

      {mode === "nearby" && (
        <NearbyPanel
          origin={payload.query.origin}
          onLocate={runNearby}
          onLocateByHost={runNearbyByHost}
          onGeocode={geocode}
          notice={notice}
          busy={busy}
        />
      )}

      {mode === "map" && (
        <SearchForm
          prefectures={payload.prefectures}
          values={{ ...form, keyword: "" }}
          onChange={(v) => {
            setForm(v);
            runSearch(v, "map");
          }}
          onSubmit={() => runSearch(form, "map")}
          busy={busy}
          hideKeyword
        />
      )}

      {failure && <p className={styles.error}>{failure}</p>}

      <ResultView
        mode={mode}
        shops={shops}
        selectedId={selected?.id}
        onSelect={onSelect}
        // 詳細は選んだカードの直下に出す。一覧の上に置くと、選んだ瞬間に
        // 一覧が下にずれて、続けて別の店を押せない。
        detail={
          selected && (
            <SelectedShop
              onAsk={() => void askAboutShop(selected)}
              onOpenMap={() => openInMaps(selected)}
              onClear={() => onSelect(null)}
              asking={asking}
            />
          )
        }
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
