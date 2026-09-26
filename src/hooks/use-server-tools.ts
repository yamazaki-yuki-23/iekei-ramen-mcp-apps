import type { App } from "@modelcontextprotocol/ext-apps";
import { useCallback, useRef, useState } from "react";
import { readPayload } from "../lib/payload";
import { askMessageText, decideMessageText } from "../lib/shop-brief";
import type { AppPayload, Bounds, Origin, OriginSource, SearchMode, Shop } from "../lib/types";

const TOOL_BY_MODE: Record<SearchMode, string> = {
  form: "search-iekei-ramen",
  nearby: "find-nearby-iekei-ramen",
  map: "show-iekei-ramen-map",
  decide: "decide-iekei-ramen",
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
  /** 選択を外し、モデル側から消えるまで待つ。 */
  releaseSelection: () => Promise<boolean>;
}

/**
 * サーバーの tool を呼ぶ側の一式。
 *
 * 画面の組み立てと混ぜると、1 つの関数に分岐が集まりすぎて読めなくなるので
 * 分けてある。通信に伴う状態（busy / asking / failure）もここが持つ。
 */
export function useServerTools({
  app,
  onPayload,
  onNotice,
  awaitContext,
  releaseSelection,
}: Options) {
  /**
   * 走っている呼び出しの数。busy はここから導く。
   *
   * 真偽値で持つと、2 本走っているときに古い方が先に終わった時点で
   * 下りてしまう。数えていれば最後の 1 本が終わるまで立ったままになる。
   */
  const [inFlight, setInFlight] = useState(0);
  const busy = inFlight > 0;
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * 画面に出ている結果が、いまの操作より古いかどうか。
   *
   * 条件を変えて呼び直した瞬間に立てる。成功すれば payload が差し替わり、
   * IekeiAppInner ごと作り直されるので、ここで戻す必要はない。失敗したときだけ
   * 立ったまま残り、前の結果を出さない判断に使う。
   *
   * これが無いと、都道府県を変えて呼び出しが落ちたときに、プルダウンは新しい
   * 県を指しているのに候補は前の県のまま残り、そのままモデルへ送れてしまう。
   */
  const [stale, setStale] = useState(false);
  /** 一覧を差し替える呼び出しの通し番号。追い越しを捨てるために使う。 */
  const resultSeq = useRef(0);

  /**
   * tool を呼ぶ。App 発の呼び出しでは ontoolresult が来ないので、
   * 戻り値に payload が入っていればここで反映する。
   */
  const call = useCallback(
    async (
      name: string,
      args: Record<string, unknown>,
      /** 結果で一覧を差し替える呼び出しか。地名の解決のような下調べは false。 */
      replacesResults = true,
    ) => {
      /*
       * 一覧を差し替える呼び出しには通し番号を振り、最後のものだけを反映する。
       * 都道府県を続けて変えると 2 本走り、先に出した方が後から返ることがある。
       * 素直に反映すると、後から選んだ条件が古い結果で上書きされ、payload から
       * 作り直されるフォームまで前の値に戻る（実際にそうなっていた）。
       */
      const seq = replacesResults ? (resultSeq.current += 1) : resultSeq.current;
      const superseded = () => replacesResults && seq !== resultSeq.current;

      setInFlight((n) => n + 1);
      setFailure(null);
      if (replacesResults) {
        setStale(true);
        /*
         * 一覧が入れ替わる時点で、開いていた店は候補ではなくなる。成功したときは
         * payload の差し替えが選択も外すが、失敗すると stale で画面からは消えるのに
         * ホストのモデル文脈には残り、消す手段が画面から無くなる。呼び出しの入口で
         * 外しておけば、成否にかかわらず残らない（タブ切り替えも同じことをしている）。
         */
        void releaseSelection();
      }
      try {
        const result = await app.callServerTool({ name, arguments: args });
        if (superseded()) return result;
        if (result.isError) {
          setFailure("検索に失敗しました。もう一度お試しください。");
          return result;
        }
        const next = readPayload(result);
        if (next) onPayload(next);
        return result;
      } catch (e) {
        if (!superseded()) setFailure(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [app, onPayload, releaseSelection],
  );

  /**
   * 条件で探し直す。
   *
   * 地図には基準地点も渡す（**絞り込みではなく、印と同心円のため**）。
   * 現在地から探した直後に地図へ移ったとき、どこから見ているのかが
   * 画面から消えないようにする。
   */
  const runSearch = useCallback(
    (next: SearchValues, targetMode: "form" | "map", origin?: Origin) => {
      void call(TOOL_BY_MODE[targetMode], {
        prefecture: next.prefecture || undefined,
        taste: next.taste || undefined,
        ...(targetMode === "form"
          ? { keyword: next.keyword || undefined }
          : {
              lat: origin?.lat,
              lon: origin?.lon,
              label: origin?.label,
              source: origin?.source,
            }),
      });
    },
    [call],
  );

  /**
   * 地図に出ている範囲で探し直す。
   *
   * **渡された条件をそのまま送る。落とすかどうかは呼ぶ側が決める。**
   * 「この範囲で探す」は枠が「どこ」を言い直しているので都道府県を空にして
   * 呼び、味だけを変えたときは今の条件のまま呼ぶ。ここで一律に落とすと、
   * 都道府県と範囲の両方が効いている状態（モデルはそう呼べる）で味を変えた
   * だけで県全体に広がる（実測: 枠の中 4 件が県全体の 6 件になった）。
   */
  const runArea = useCallback(
    (bounds: Bounds, next: SearchValues, origin?: Origin) => {
      void call(TOOL_BY_MODE.map, {
        prefecture: next.prefecture || undefined,
        taste: next.taste || undefined,
        bounds,
        // 基準地点は「どこ」の条件ではないので、範囲を変えても持ち続ける。
        lat: origin?.lat,
        lon: origin?.lon,
        label: origin?.label,
        source: origin?.source,
      });
    },
    [call],
  );

  /**
   * 3 軒に絞り直す。round を増やすと次の 3 軒になる。
   * 基準地点があれば近い順、無ければ営業時間が分かる店からになる。
   *
   * **キーワードは呼び出し側が明示する。** 検索フォームに残っていた語が
   * 勝手に効くと、候補が減っていても理由が画面に出ず外せない。一方で、
   * モデルがキーワード付きで開いた画面から巡回するときに落とすと、母数が
   * 全国に広がって無関係な店が出る。いま効いている語（payload 側）だけを
   * 引き継ぎ、タブに入り直したときは持ち込まない、という切り分けにしてある。
   *
   * 基準地点の出どころもそのまま渡す。落とすと「指定した地名」に化けて、
   * 現在地モードへ戻ったときに誤った精度が表示される。
   */
  const runDecide = useCallback(
    (next: SearchValues, origin: Origin | undefined, round: number, keyword?: string) => {
      void call(TOOL_BY_MODE.decide, {
        prefecture: next.prefecture || undefined,
        taste: next.taste || undefined,
        keyword: keyword || undefined,
        lat: origin?.lat,
        lon: origin?.lon,
        label: origin?.label,
        source: origin?.source,
        round,
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
      const result = await call("geocode-place", { query }, false);
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

  /** ホスト経由で外部リンクを開く。iframe から直接 window.open はできない。 */
  const openExternal = useCallback(
    (url: string) => {
      if (url) void app.openLink({ url });
    },
    [app],
  );

  const openInMaps = useCallback(
    (shop: Shop) => {
      openExternal(
        `https://www.openstreetmap.org/?mlat=${shop.lat}&mlon=${shop.lon}#map=18/${shop.lat}/${shop.lon}`,
      );
    },
    [openExternal],
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

  /**
   * 3 軒をまとめてモデルに渡し、1 軒を理由つきで推してもらう。
   *
   * 候補は選択（updateModelContext）とは別物なので、context には載せない。
   * 選択は 1 軒を指すもので、そこに 3 軒を混ぜると「いまどれが選ばれて
   * いるのか」が壊れる。3 軒はこの一通にだけ入れる。
   */
  const askToDecide = useCallback(
    async (shops: Shop[], basis: string) => {
      setAsking(true);
      setFailure(null);
      try {
        /*
         * 開いていた店があれば、先に外してモデル側から消えるまで待つ。
         * 「この店を選んだ」という文脈を残したまま「この中から選んで」と頼むと、
         * 相反する 2 つが同時に届き、答えが開いていた店に引きずられる。
         * updateModelContext は次の発話まで待つので、送ってから消しても遅い。
         */
        const cleared = await releaseSelection();
        const text = decideMessageText(shops, basis, cleared);
        const result = await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
        if (result.isError) setFailure("ホストがメッセージの送信を受け付けませんでした。");
      } catch (e) {
        setFailure(e instanceof Error ? e.message : String(e));
      } finally {
        setAsking(false);
      }
    },
    [app, releaseSelection],
  );

  return {
    busy,
    asking,
    failure,
    stale,
    runSearch,
    runArea,
    runDecide,
    askToDecide,
    runNearby,
    runNearbyByHost,
    geocode,
    openInMaps,
    openExternal,
    askAboutShop,
  };
}
