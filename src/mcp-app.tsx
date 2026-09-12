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
 */
import type { CallToolResult } from "@modelcontextprotocol/client";
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { StrictMode, useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { MapView } from "./components/MapView";
import { NearbyPanel } from "./components/NearbyPanel";
import { SearchForm, type FormValues } from "./components/SearchForm";
import { ShopList } from "./components/ShopList";
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

  const applyPayload = useCallback((next: AppPayload) => {
    setPayload(next);
    setPayloadVersion((v) => v + 1);
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
  hostContext?: McpUiHostContext;
}

/**
 * payload ごとに key で作り直されるので、状態は props からそのまま初期化できる。
 * tool 結果が届くたびにモード・フォーム・選択状態が新しい payload に揃う。
 */
function IekeiAppInner({ app, payload, onPayload, notice, onNotice, hostContext }: InnerProps) {
  const [mode, setMode] = useState<SearchMode>(payload.mode);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>();
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
      setSelectedId(undefined);
      if (next === "form" || next === "map") runSearch(form, next);
    },
    [form, runSearch],
  );

  const openInMaps = useCallback(
    (shop: Shop) => {
      void app.openLink({
        url: `https://www.openstreetmap.org/?mlat=${shop.lat}&mlon=${shop.lon}#map=18/${shop.lat}/${shop.lon}`,
      });
    },
    [app],
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

      {mode === "map" ? (
        <div className={styles.mapLayout}>
          <MapView shops={shops} selectedId={selectedId} onSelect={(s) => setSelectedId(s.id)} />
          <ShopList
            shops={selectedId ? shops.filter((s) => s.id === selectedId) : shops.slice(0, 20)}
            selectedId={selectedId}
            onSelect={openInMaps}
            emptyMessage="この条件では地図に表示できる店舗がありません。"
          />
        </div>
      ) : (
        <ShopList
          shops={shops}
          ranked={mode === "nearby"}
          selectedId={selectedId}
          onSelect={openInMaps}
          emptyMessage={
            mode === "nearby"
              ? "現在地を指定すると近い順に 5 件表示します。"
              : "条件に合う店舗が見つかりませんでした。"
          }
        />
      )}

      <p className={styles.footnote}>
        店舗データは OpenStreetMap（ODbL）由来。「家系の可能性」は店名から推定したもので、
        味の傾向は既知のブランドから割り当てた参考値です。営業時間は変わることがあるため訪問前にご確認ください。
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IekeiApp />
  </StrictMode>,
);
