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
import type { CallToolResult } from "@modelcontextprotocol/client";
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MapView } from "./components/MapView";
import { NearbyPanel } from "./components/NearbyPanel";
import { SearchForm, type FormValues } from "./components/SearchForm";
import { SelectedShop } from "./components/SelectedShop";
import { ShopList } from "./components/ShopList";
import { askMessageText, describeShop } from "./lib/shop-brief";
import type { AppPayload, OriginSource, SearchMode, Shop } from "./lib/types";
import styles from "./mcp-app.module.css";

const MODES: Array<{ key: SearchMode; label: string }> = [
  { key: "form", label: "検索フォーム" },
  { key: "nearby", label: "現在地から探す" },
  { key: "map", label: "地図から探す" },
];

const TOOL_BY_MODE: Record<SearchMode, string> = {
  form: "search-iekei-ramen",
  nearby: "find-nearby-iekei-ramen",
  map: "show-iekei-ramen-map",
};

const EMPTY_PAYLOAD: AppPayload = {
  mode: "form",
  shops: [],
  total: 0,
  query: {},
  prefectures: [],
};

function readPayload(result: CallToolResult): AppPayload | null {
  const sc = result.structuredContent as unknown;
  if (!sc || typeof sc !== "object" || !("shops" in sc)) return null;
  return sc as AppPayload;
}

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
  const contextQueue = useRef<Promise<unknown>>(Promise.resolve());
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

    contextQueue.current = contextQueue.current.then(async () => {
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
  const [mode, setMode] = useState<SearchMode>(payload.mode);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [form, setForm] = useState<FormValues>({
    prefecture: payload.query.prefecture ?? "",
    taste: payload.query.taste && payload.query.taste !== "unknown" ? payload.query.taste : "",
    keyword: payload.query.keyword ?? "",
  });

  /**
   * tool を呼ぶ。App 発の呼び出しでは ontoolresult が来ないので、
   * 戻り値に payload が入っていればここで反映する。
   */
  const call = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      setBusy(true);
      setFailure(null);
      try {
        const result = await app.callServerTool({ name, arguments: args });
        if (result.isError) {
          setFailure("検索に失敗しました。もう一度お試しください。");
          return result;
        }
        const next = readPayload(result);
        if (next) onPayload(next);
        return result;
      } catch (e) {
        setFailure(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [app, onPayload],
  );

  const runSearch = useCallback(
    (next: FormValues, targetMode: "form" | "map") => {
      void call(TOOL_BY_MODE[targetMode], {
        prefecture: next.prefecture || undefined,
        taste: next.taste || undefined,
        ...(targetMode === "form" ? { keyword: next.keyword || undefined } : {}),
      });
    },
    [call],
  );

  const runNearby = useCallback(
    (lat: number, lon: number, label: string | undefined, source: OriginSource) => {
      onNotice(null);
      void call("find-nearby-iekei-ramen", { lat, lon, limit: 5, label, source });
    },
    [call, onNotice],
  );

  /**
   * 座標を渡さずに呼び、ホストが持つ大まかな現在地に任せる。
   * ChatGPT のように iframe の geolocation が塞がれたホスト向けの経路。
   */
  const runNearbyByHost = useCallback(async () => {
    const result = await call("find-nearby-iekei-ramen", { limit: 5 });
    const located = Boolean((result && readPayload(result))?.query.origin);
    onNotice(located ? null : "現在地を取得できませんでした。下の欄に地名を入力してください。");
    return located;
  }, [call, onNotice]);

  const geocode = useCallback(
    async (query: string) => {
      const result = await call("geocode-place", { query });
      const hits = (
        result?.structuredContent as {
          results?: Array<{ label: string; lat: number; lon: number }>;
        }
      )?.results;
      if (!hits || hits.length === 0) return null;
      const [first] = hits;
      return { lat: first.lat, lon: first.lon, label: first.label.split(",")[0].trim() };
    },
    [call],
  );

  const switchMode = useCallback(
    (next: SearchMode) => {
      setMode(next);
      onSelect(null);
      if (next === "form" || next === "map") runSearch(form, next);
    },
    [form, onSelect, runSearch],
  );

  const openInMaps = useCallback(
    (shop: Shop) => {
      void app.openLink({
        url: `https://www.openstreetmap.org/?mlat=${shop.lat}&mlon=${shop.lon}#map=18/${shop.lat}/${shop.lon}`,
      });
    },
    [app],
  );

  /**
   * 選択中の店を話題にして会話に戻す。
   *
   * 店の詳細は外側が updateModelContext で渡してあるので、届いていれば短い一文で足りる。
   * ホストが未対応だったり失敗したりしたときは、質問に詳細を同梱する。
   * 店名だけを送ると、モデルが但し書き無しに自分の知識で答えてしまうため。
   */
  const askAboutShop = useCallback(
    async (shop: Shop) => {
      setAsking(true);
      setFailure(null);
      try {
        const text = askMessageText(shop, await awaitContext(shop));
        const result = await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
        if (result.isError) setFailure("ホストがメッセージの送信を受け付けませんでした。");
      } catch (e) {
        setFailure(e instanceof Error ? e.message : String(e));
      } finally {
        setAsking(false);
      }
    },
    [app, awaitContext],
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
  const hasMore = !awaitingOrigin && payload.total > shops.length;

  return (
    <main
      className={styles.main}
      style={{
        paddingTop: hostContext?.safeAreaInsets?.top,
        paddingRight: hostContext?.safeAreaInsets?.right,
        paddingBottom: hostContext?.safeAreaInsets?.bottom,
        paddingLeft: hostContext?.safeAreaInsets?.left,
      }}
    >
      <div className={styles.header}>
        <h1 className={styles.title}>🍜 {heading}</h1>
        {!awaitingOrigin && (
          <span className={styles.count}>
            {payload.total} 件{hasMore ? `（${shops.length} 件表示）` : ""}
          </span>
        )}
      </div>

      <div className={styles.tabs} role="tablist">
        {MODES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            className={`${styles.tab} ${mode === key ? styles.tabActive : ""}`}
            onClick={() => switchMode(key)}
            disabled={busy}
          >
            {label}
          </button>
        ))}
      </div>

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

      {selected && (
        <SelectedShop
          shop={selected}
          onAsk={() => void askAboutShop(selected)}
          onOpenMap={() => openInMaps(selected)}
          onClear={() => onSelect(null)}
          asking={asking}
        />
      )}

      {mode === "map" ? (
        <div className={styles.mapLayout}>
          <MapView shops={shops} selectedId={selected?.id} onSelect={onSelect} />
          {/* 選んだ店は上のパネルに出るので、一覧は絞り込まずそのまま残す。 */}
          <ShopList
            shops={shops.slice(0, 20)}
            selectedId={selected?.id}
            onSelect={onSelect}
            emptyMessage="この条件では地図に表示できる店舗がありません。"
          />
        </div>
      ) : (
        <ShopList
          shops={shops}
          ranked={mode === "nearby"}
          selectedId={selected?.id}
          onSelect={onSelect}
          emptyMessage={
            mode === "nearby"
              ? "現在地を指定すると近い順に 5 件表示します。"
              : "条件に合う店舗が見つかりませんでした。"
          }
        />
      )}

      <p className={styles.footnote}>
        店舗データは OpenStreetMap（ODbL）由来。「家系の可能性」は店名から家系と推定したもの、
        「家系か未判定」は店名だけでは判断できなかったものです。味の傾向は既知のブランドから
        割り当てた参考値で、多くの店舗は「情報なし」になります。
        営業時間は変わることがあるため訪問前にご確認ください。
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IekeiApp />
  </StrictMode>,
);
