import type { App } from "@modelcontextprotocol/ext-apps";
import { useCallback, useState } from "react";
import { readPayload } from "../lib/payload";
import { askMessageText } from "../lib/shop-brief";
import type { AppPayload, OriginSource, SearchMode, Shop } from "../lib/types";

const TOOL_BY_MODE: Record<SearchMode, string> = {
  form: "search-iekei-ramen",
  nearby: "find-nearby-iekei-ramen",
  map: "show-iekei-ramen-map",
};

/** 検索フォームの値。tool の引数に組み立て直す。 */
export interface SearchValues {
  prefecture: string;
  taste: string;
  keyword: string;
}

interface Options {
  app: App;
  onPayload: (payload: AppPayload) => void;
  onNotice: (notice: string | null) => void;
  /** その店の詳細がモデルに届いたか。届いていなければ質問に詳細を同梱する。 */
  awaitContext: (shop: Shop) => Promise<boolean>;
}

/**
 * サーバーの tool を呼ぶ側の一式。
 *
 * 画面の組み立てと混ぜると、1 つの関数に分岐が集まりすぎて読めなくなるので
 * 分けてある。通信に伴う状態（busy / asking / failure）もここが持つ。
 */
export function useServerTools({ app, onPayload, onNotice, awaitContext }: Options) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

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
    (next: SearchValues, targetMode: "form" | "map") => {
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
   * 店の詳細は updateModelContext で渡してあるので、届いていれば短い一文で足りる。
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

  return {
    busy,
    asking,
    failure,
    runSearch,
    runNearby,
    runNearbyByHost,
    geocode,
    openInMaps,
    askAboutShop,
  };
}
