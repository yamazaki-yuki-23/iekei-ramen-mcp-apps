import type { UiHost } from "../hosts/types";
import { useCallback, useRef, useState } from "react";
import { readPayload, readVisitResult } from "../lib/payload";
import {
  askMessageText,
  decideMessageText,
  stampMessageText,
  visitedSignInText,
} from "../lib/shop-brief";
import type {
  AppPayload,
  Bounds,
  DecideInfo,
  Origin,
  OriginSource,
  SearchMode,
  Shop,
  VisitResult,
} from "../lib/types";

/*
 * 記録に失敗したときの文。**サインインの切れも同じ見え方になる。**
 * UI からの呼び出しで 401 を受けても、ホストはサインインの画面を出さないので、
 * 会話へ戻る道を文で示す。
 */
const STAMP_FAILED =
  "記録できませんでした。サインインが切れているかもしれません。チャットで「行った店を見せて」と頼むと入り直せます。";

/** 地名の解決が、答えを受け取る前に落ちたときの文。 */
const GEOCODE_UNREACHED = "地名の検索に失敗しました。通信を確かめて、もう一度お試しください。";

const TOOL_BY_MODE: Record<SearchMode, string> = {
  form: "search-iekei-ramen",
  nearby: "find-nearby-iekei-ramen",
  map: "show-iekei-ramen-map",
  decide: "decide-iekei-ramen",
  visited: "show-visited-iekei-ramen",
};

/** 検索フォームの値。tool の引数に組み立て直す。 */
export interface SearchValues {
  prefecture: string;
  taste: string;
  keyword: string;
}

interface Options {
  app: UiHost;
  /** 呼び出し開始時点の下書きとホスト更新を記録し、応答を反映する。 */
  capturePayload: () => (payload: AppPayload) => boolean;
  onNotice: (notice: string | null) => void;
  /** その店の詳細がモデルに届いたか。届いていなければ質問に詳細を同梱する。 */
  awaitContext: (shop: Shop) => Promise<boolean>;
  /** 選択を外し、モデル側から消えるまで待つ。 */
  releaseSelection: () => Promise<boolean>;
  /**
   * 記録の更新を反映する。
   *
   * **payload ごと入れ替えない。** スタンプの結果は mode: "visited" で返るので、
   * 素直に反映すると検索結果を見ていた人が「行った店」の画面へ飛ばされる。
   * どこまで写すかは受け取る側が決める（「行った店」の画面だけ一覧も差し替える）。
   */
  onVisits: (next: VisitResult) => void;
  /** 「行った店」では取り消したカードも除くため、完全な一覧を要求する。 */
  includeVisitedShops: boolean;
  /**
   * 返ってきていない呼び出しを数える（始めに +1、反映し終えたら -1）。
   *
   * **数は作り直されない外側が持つ。** この部品は payload ごとに作り直されるので、
   * 中で数えると、作り直した直後に古い呼び出しが残っていても 0 になる。
   */
  trackCall: (delta: 1 | -1) => void;
}

/**
 * サーバーの tool を呼ぶ側の一式。
 *
 * 画面の組み立てと混ぜると、1 つの関数に分岐が集まりすぎて読めなくなるので
 * 分けてある。通信に伴う状態（busy / asking / failure）もここが持つ。
 */
export function useServerTools({
  app,
  capturePayload,
  onNotice,
  awaitContext,
  releaseSelection,
  onVisits,
  includeVisitedShops,
  trackCall,
}: Options) {
  const stampFailed = app.capabilities.model
    ? STAMP_FAILED
    : "記録できませんでした。サインインを確認し、もう一度お試しください。";
  /**
   * 走っている呼び出しの数。busy はここから導く。
   *
   * 真偽値で持つと、2 本走っているときに古い方が先に終わった時点で
   * 下りてしまう。数えていれば最後の 1 本が終わるまで立ったままになる。
   */
  const [inFlight, setInFlight] = useState(0);
  const busy = inFlight > 0;
  const [asking, setAsking] = useState(false);
  /**
   * 記録を書き換えている最中か。
   *
   * **検索とは別に数える。** 記録の応答にはその時点の記録の全体が入っており、
   * 同時に走った検索の応答にも入っている。**あとから届いた方が勝つ**ので、
   * 書き換えの最中に別の検索を始めさせない（タブはこれで止める）。
   * 検索は遅い（地図は 558 件）が、記録の書き換えは 1 往復で終わるので、
   * 止まって見える時間はほとんど無い。
   */
  const [mutations, setMutations] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * 「もう一度試す」で繰り返す操作。一覧を差し替える操作（run*）が、自分自身を同じ
   * 引数で呼び直す形で残す。生の tool 呼び出しを繰り返すと、操作ごとの前後の処理
   * （現在地の案内を消す・記録の削除中はタブを止める）を飛ばしてしまう。payload から
   * 組み直すと、届かなかった条件（新しく取った現在地など）が失われる。
   */
  const lastAction = useRef<(() => unknown) | null>(null);
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
  const [needsSearch, setNeedsSearch] = useState(false);
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
      const applyPayload = capturePayload();
      const seq = replacesResults ? (resultSeq.current += 1) : resultSeq.current;
      const superseded = () => replacesResults && seq !== resultSeq.current;

      setInFlight((n) => n + 1);
      trackCall(1);
      setFailure(null);
      if (replacesResults) {
        setNeedsSearch(false);
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
          // 下調べ（地名の解決）の失敗は、理由ごと呼んだ側が出す。一覧の下に
          // 「検索に失敗しました」を重ねると、入力欄の案内と 2 つの文が並ぶ。
          if (replacesResults) setFailure("検索に失敗しました。もう一度お試しください。");
          return result;
        }
        const next = readPayload(result);
        if (next && !applyPayload(next)) setNeedsSearch(true);
        return result;
      } catch (e) {
        // 下調べの失敗は、isError のときと同じく呼んだ側が出す。
        if (!superseded() && replacesResults) {
          setFailure(e instanceof Error ? e.message : String(e));
        }
        return null;
      } finally {
        // 反映（applyPayload）と同じ流れで減らす。同じ描画にまとまるので、0 になった
        // 画面には、この応答で起きることがすべて出ている。
        setInFlight((n) => n - 1);
        trackCall(-1);
      }
    },
    [app, capturePayload, releaseSelection, trackCall],
  );

  /**
   * 走っている「一覧を差し替える呼び出し」を捨てる。
   *
   * **tool を呼ばずにモードを移るときに要る。** 通し番号は呼ぶたびに進むので、
   * 呼ばない移り方（基準地点の無い現在地・匿名の「行った店」）では前の呼び出しが
   * 生き残り、**あとから届いてモードごと引き戻す**（payload でモードが決まるため）。
   */
  const discardPending = useCallback(() => {
    resultSeq.current += 1;
    setStale(false);
  }, []);

  /**
   * 条件で探し直す。
   *
   * 地図には基準地点も渡す（**絞り込みではなく、印と同心円のため**）。
   * 現在地から探した直後に地図へ移ったとき、どこから見ているのかが
   * 画面から消えないようにする。
   */
  const runSearch = useCallback(
    function runSearchOp(next: SearchValues, targetMode: "form" | "map", origin?: Origin) {
      lastAction.current = () => runSearchOp(next, targetMode, origin);
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
    function runAreaOp(bounds: Bounds, next: SearchValues, origin?: Origin) {
      lastAction.current = () => runAreaOp(bounds, next, origin);
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
    function runDecideOp(
      next: SearchValues,
      origin: Origin | undefined,
      round: number,
      keyword?: string,
    ) {
      lastAction.current = () => runDecideOp(next, origin, round, keyword);
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

  /**
   * 行った印を付ける／外す。
   *
   * **結果で一覧を差し替えない。** この tool の payload は mode: "visited" なので、
   * 素直に反映すると、検索結果を見ていた人が「行った店」の画面へ飛ばされる。
   * 記録の部分（visited / progress）だけを差し、画面はそのまま残す。
   */
  const sendStamp = useCallback(
    async (shopId: string, visited: boolean) => {
      try {
        const result = await app.callServerTool({
          name: "stamp-iekei-ramen",
          arguments: { shopId, visited, includeShops: includeVisitedShops },
        });
        if (result.isError) {
          setFailure(stampFailed);
          return;
        }
        const next = readVisitResult(result);
        // visited が無いのは、サインインが切れて匿名として処理されたとき。
        // 黙って成功に見せない。
        if (next && (!includeVisitedShops || "shops" in next)) onVisits(next);
        else setFailure(stampFailed);
      } catch {
        setFailure(stampFailed);
      }
    },
    [app, onVisits, includeVisitedShops, stampFailed],
  );

  /**
   * 行った印を付ける／外す。**1 本ずつ順に投げる。**
   *
   * 応答にはその時点の記録の全体が入っているので、同時に投げると**先に押した方の
   * 古い写しが後に返り、あとから押した店を画面から消す**（実測: 2 軒続けて押すと
   * バッジが 1 つになった。記録そのものは両方残っている）。直列にすれば、
   * 2 本目の応答は 1 本目を含んだ写しになり、画面と記録が合う。
   *
   * **釦を押せなくする形にはしない。** 押せるのに反応しない時間ができるより、
   * 押した順に効く方が読める。
   */
  // null 始まりにするのは、毎レンダーで捨てる Promise を作らないため。
  const stampQueue = useRef<Promise<void> | null>(null);
  const runStamp = useCallback(
    (shopId: string, visited: boolean) => {
      setInFlight((n) => n + 1);
      setMutations((n) => n + 1);
      trackCall(1);
      setFailure(null);
      const done = (stampQueue.current ?? Promise.resolve())
        .then(() => sendStamp(shopId, visited))
        .finally(() => {
          setInFlight((n) => n - 1);
          setMutations((n) => n - 1);
          trackCall(-1);
        });
      // 失敗で列を止めない。1 本落ちても、次の操作は投げられる。
      stampQueue.current = done.catch(() => {});
      return done;
    },
    [sendStamp, trackCall],
  );

  /** 行った店の一覧と制覇率を取り直す。こちらは画面ごと入れ替わる。 */
  const runVisited = useCallback(
    function runVisitedOp() {
      lastAction.current = () => runVisitedOp();
      void call(TOOL_BY_MODE.visited, {});
    },
    [call],
  );

  /** 記録を全部消す。戻せないので、呼ぶ側が確認を取ってから来ること。 */
  const runForget = useCallback(
    function runForgetOp() {
      lastAction.current = () => runForgetOp();
      setMutations((n) => n + 1);
      void call("forget-my-iekei-ramen-visits", {}).finally(() => setMutations((n) => n - 1));
    },
    [call],
  );

  /**
   * 会話へ一通送る。
   *
   * **本文の組み立ても中で呼ぶ。** 送る前に待つもの（モデルへ渡した文脈の確認、
   * 選択の解除）があり、そこで転んだときも同じ扱いにしたいため。
   */
  const sendText = useCallback(
    async (build: () => string | Promise<string>) => {
      setAsking(true);
      setFailure(null);
      try {
        const result = await app.sendMessage({
          role: "user",
          content: [{ type: "text", text: await build() }],
        });
        if (result.isError) setFailure("ホストがメッセージの送信を受け付けませんでした。");
      } catch (e) {
        setFailure(e instanceof Error ? e.message : String(e));
      } finally {
        setAsking(false);
      }
    },
    [app],
  );

  /**
   * サインインしていない人の「行った」。
   *
   * UI から呼んでも 401 でホストは何も出さないので、依頼文にして会話へ渡す。
   * モデルが tool を呼び、ホストがサインインを促す（ChatGPT で実測）。
   */
  const askToStamp = useCallback(
    (shop: Shop) => sendText(() => stampMessageText(shop)),
    [sendText],
  );

  /** サインインしていない人が「行った店」を開いたとき、会話でサインインを頼む。 */
  const askToSignIn = useCallback(() => sendText(visitedSignInText), [sendText]);

  const runNearby = useCallback(
    function runNearbyOp(
      lat: number,
      lon: number,
      label: string | undefined,
      source: OriginSource,
    ) {
      lastAction.current = () => runNearbyOp(lat, lon, label, source);
      onNotice(null);
      void call("find-nearby-iekei-ramen", {
        lat,
        lon,
        limit: 5,
        label,
        source,
      });
    },
    [call, onNotice],
  );

  /**
   * 座標を渡さずに呼び、ホストが持つ大まかな現在地に任せる。
   * ChatGPT のように iframe の geolocation が塞がれたホスト向けの経路。
   */
  const runNearbyByHost = useCallback(
    async function runNearbyByHostOp() {
      lastAction.current = () => runNearbyByHostOp();
      const started = resultSeq.current + 1;
      onNotice(null);
      const result = await call("find-nearby-iekei-ramen", { limit: 5 });
      // 結果を捨てるときは、再マウントをまたいで残る案内も更新しない。
      if (resultSeq.current !== started) return false;
      const located = Boolean((result && readPayload(result))?.query.origin);
      onNotice(located ? null : "現在地を取得できませんでした。下の欄に地名を入力してください。");
      return located;
    },
    [call, onNotice],
  );

  const geocode = useCallback(
    async (query: string) => {
      const result = await call("geocode-place", { query }, false);
      /*
       * **失敗を「見つからない」にしない。** 連打止めや Nominatim の不調で落ちたのに
       * 「見つかりませんでした」と出すと、地名の方を疑って打ち直し、さらに叩く。
       */
      // 呼び出しそのものが落ちた（通信・ホストの不調）。結果が無いのは「0 件」ではない。
      if (!result) throw new Error(GEOCODE_UNREACHED);
      if (result.isError) {
        const text = (result.content as Array<{ type: string; text?: string }>).find(
          (c) => c.type === "text",
        )?.text;
        throw new Error(text ?? "地名の検索に失敗しました。");
      }
      const hits = (
        result.structuredContent as {
          results?: Array<{ label: string; lat: number; lon: number }>;
        }
      )?.results;
      if (!hits || hits.length === 0) return null;
      const [first] = hits;
      return {
        lat: first.lat,
        lon: first.lon,
        label: first.label.split(",")[0].trim(),
      };
    },
    [call],
  );

  /**
   * 地名を座標に直してから、そこで探す。**一続きで扱う。**
   *
   * 地名の解決（geocode-place）は一覧を差し替えない呼び出しなので通し番号が
   * 進まない。解決を待つ間に別のタブへ移られると、**あとから現在地検索が走って
   * 押したタブから引き戻される**（Codex の指摘で気付いた）。
   * 始めた時点の番号を覚えておき、途中で別の操作が入っていたら捨てる。
   */
  const searchPlace = useCallback(
    async (query: string) => {
      const started = resultSeq.current;
      const hit = await geocode(query);
      if (!hit) return null;
      // 待っている間に別のモードへ移った（あるいは別の検索が走った）。
      if (resultSeq.current !== started) return null;
      runNearby(hit.lat, hit.lon, hit.label, "place");
      return hit;
    },
    [geocode, runNearby],
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
    (shop: Shop) => sendText(async () => askMessageText(shop, await awaitContext(shop))),
    [awaitContext, sendText],
  );

  /**
   * 3 軒をまとめてモデルに渡し、1 軒を理由つきで推してもらう。
   *
   * 候補は選択（updateModelContext）とは別物なので、context には載せない。
   * 選択は 1 軒を指すもので、そこに 3 軒を混ぜると「いまどれが選ばれて
   * いるのか」が壊れる。3 軒はこの一通にだけ入れる。
   */
  const askToDecide = useCallback(
    (shops: Shop[], basis: string, info: DecideInfo | undefined) =>
      /*
       * 開いていた店があれば、先に外してモデル側から消えるまで待つ。
       * 「この店を選んだ」という文脈を残したまま「この中から選んで」と頼むと、
       * 相反する 2 つが同時に届き、答えが開いていた店に引きずられる。
       * updateModelContext は次の発話まで待つので、送ってから消しても遅い。
       */
      sendText(async () => decideMessageText(shops, basis, await releaseSelection(), info)),
    [releaseSelection, sendText],
  );

  /** 最後に一覧を差し替えようとした操作を、同じ引数で前後の処理ごともう一度行う。 */
  const retry = useCallback(() => {
    void lastAction.current?.();
  }, []);

  return {
    retry,
    busy,
    /** 記録を書き換えている最中。タブを止めるのはこの間だけ。 */
    mutating: mutations > 0,
    asking,
    failure,
    stale,
    needsSearch,
    runSearch,
    runArea,
    runDecide,
    discardPending,
    runStamp,
    runVisited,
    runForget,
    askToStamp,
    askToSignIn,
    askToDecide,
    runNearby,
    runNearbyByHost,
    geocode,
    searchPlace,
    openInMaps,
    openExternal,
    askAboutShop,
  };
}
