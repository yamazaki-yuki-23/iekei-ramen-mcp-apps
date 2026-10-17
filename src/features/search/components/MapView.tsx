import type { ErrorEvent, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { useMarkerFocus } from "../hooks/use-marker-focus";
import { useVisitedMarkers } from "../hooks/use-visited-markers";
import type { Bounds, Shop } from "../../../types";
import styles from "../styles/search.module.css";
import {
  boundsOf,
  canStartWorker,
  createMap,
  drawOrigin,
  drawRoute,
  drawShops,
  FIT_MAX_ZOOM,
  focusWithoutScrolling,
  JAPAN_BOUNDS,
  ROUTE_MAX_ZOOM,
  SELECT_ZOOM,
  viewBounds,
  type MapOrigin,
} from "../lib/map-layers";
import { MapLegend } from "./MapLegend";
import { StateNote } from "./StateNote";

/** 店のピンのデータが読めるまで待つ上限。過ぎたら、この画面では地図を描けないと見なす。 */
const DRAW_TIMEOUT_MS = 15_000;

interface Props {
  shops: Shop[];
  selectedId?: string;
  onSelect: (shop: Shop) => void;
  /** 「まわる店」の順路。回る順に並んだ状態で受け取る。 */
  route?: Shop[];
  /** 順路の出発点。あれば線をここから引く。 */
  routeOrigin?: { lat: number; lon: number };
  /** 基準地点。あれば印と同心円を出す。 */
  origin?: MapOrigin;
  /** 塊を押したときに、その中身を渡す。寄っても解けない塊への逃げ道。 */
  onClusterSelect?: (shops: Shop[], viaKeyboard: boolean) => void;
  /** 全画面のときは地図を高くする。 */
  expanded?: boolean;
  /**
   * 範囲の読み取り口を外へ渡す。
   *
   * **動かすたびに値を流さない。** 直近の移動を覚えておく形にすると、
   * 寄せ終わる前に押されたときに古い範囲で探してしまう（実際に踏んだ:
   * 塊を押した直後に「この範囲で発券」を押すと、全国 558 件のまま返った）。
   * 押した瞬間に読む。
   */
  onReady?: (getBounds: () => Bounds) => void;
  /**
   * 最初に表示する範囲。
   *
   * **payload から渡す。** 結果が差し替わるとこの部品ごと作り直されるので
   * （payload ごとに key を振ってある）、地図は毎回新品で生まれる。
   * 覚えていたつもりの画角は残らず、「この範囲で発券」の直後に日本全体へ
   * 戻ってしまう（実測: 範囲で 489 件に絞った直後、もう一度押すと 558 件）。
   */
  initialBounds?: Bounds;
  /**
   * 結果が変わったときに全体へ寄せ直すか。
   * 範囲で探し直した直後は false。ユーザーが自分で決めた画角を動かさない。
   */
  refit?: boolean;
  /** 行った店。ピンの右上に印を付ける。匿名なら渡ってこない。 */
  visitedIds?: ReadonlySet<string>;
  /** この画面では地図を描けないと分かったとき。親は地図の道具（範囲で発券・全画面）を外す。 */
  onCannotDraw?: () => void;
}

/**
 * 地図。
 *
 * **ここが持つのは「いつ描くか」だけ。** 何をどう描くかは map-layers.ts にある。
 * 節の順番に意味があるので、足すときは各節のコメントを読んでから位置を決めること。
 */
export function MapView({
  shops,
  selectedId,
  onSelect,
  route,
  routeOrigin,
  origin,
  onClusterSelect,
  expanded = false,
  onReady,
  initialBounds,
  refit = true,
  visitedIds,
  onCannotDraw,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const buttonsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const shopDrawingRef = useRef<ReturnType<typeof drawShops> | null>(null);
  /*
   * 最後に線を引いたときの順路と出発点。**変わったときだけ寄せる**ために比べる。
   * 初期値は作り直したときの値にしておく。**作り直しの 1 回目は寄せない。** 範囲で探した直後は、
   * ユーザーが決めた画角が初期表示に入っている。そこへ順路が割り込むと、見出しと結果は範囲の
   * ものなのに地図だけ順路へ飛ぶ（実測: 同じ操作の 2 回目で 3 件 → 2 件）。
   * 「1 回目か」の真偽値で持つと、StrictMode が effect を 2 回走らせたときに誤る（#157）。
   */
  const lastRoute = useRef({ route, routeOrigin });
  const { remember, restore } = useMarkerFocus(buttonsRef);
  /*
   * 地図の準備ができたか（スタイルと重ねる層を足し終えたか）と、いまのズーム。塊の大きさは
   * ズームで決まるので、state で持って描き直す。ref だと変わっても再描画が起きず、寄っても
   * 塊が解けない。
   */
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(5);
  /*
   * この画面では地図を描けない（WebGL が無い、地図の描画に使う Worker が止められた）。
   * 空白や壊れた地図を出さず、地図の場所で一覧と Web 版へ案内する。背景の地図データが
   * 取れないだけなら、店のピンは出るので、ここには来ない。
   */
  const [cannotDraw, setCannotDraw] = useState(false);

  // ハンドラは 1 度だけ登録するので、最新の関数を ref 経由で参照する。
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  const onClusterRef = useRef(onClusterSelect);
  useEffect(() => {
    onClusterRef.current = onClusterSelect;
  }, [onClusterSelect]);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  const onCannotDrawRef = useRef(onCannotDraw);
  useEffect(() => {
    onCannotDrawRef.current = onCannotDraw;
  }, [onCannotDraw]);

  // 地図の生成は 1 度だけ。以降はデータだけ差し替える。
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    let map: ReturnType<typeof createMap>;
    try {
      // 店のピンを重ねる層ができたら描き始める（背景の地図データを待たない）。
      map = createMap(container, initialBounds, () => {
        setZoom(map.getZoom());
        setReady(true);
      });
    } catch {
      // 作る時点で失敗する（WebGL が無い、Worker を作れない）。
      setCannotDraw(true);
      onCannotDrawRef.current?.();
      return;
    }
    mapRef.current = map;
    /*
     * 描けないと分かったら、**案内に切り替える前に地図を壊す。** 切り替えると地図の入れ物は
     * 消えるが、この節の後片付けは部品ごと外れるまで走らないので、地図・Worker・受け口が
     * 外れた入れ物の上で生き続ける。
     */
    let alive = true;
    const giveUp = () => {
      if (!alive) return;
      alive = false;
      // 先に案内へ切り替える。Worker が壊れていると、地図を壊す途中で例外が出ることがある。
      setReady(false);
      setCannotDraw(true);
      onCannotDrawRef.current?.();
      mapRef.current = null;
      try {
        map.remove();
      } catch {
        // 壊せなかった地図は、外れた入れ物ごと捨てる（ほかに手は無い）。
      }
    };
    // 描画の Worker が動くかを、地図とは別に確かめる（6 系は動かなくても地図の側でエラーにならない）。
    void canStartWorker().then((ok) => {
      if (!ok) giveUp();
    });
    // Worker が止められたことは、地図のエラーとして届くこともある。
    const onError = (e: ErrorEvent) => {
      if (/worker/i.test(e.error?.message ?? "")) giveUp();
    };
    // 黙って止まることもあるので、店のピンのデータが読めたかを時間で確かめる。
    const watchdog = setTimeout(() => {
      if (!map.getSource("shops") || !map.isSourceLoaded("shops")) giveUp();
    }, DRAW_TIMEOUT_MS);
    /*
     * **1 回でも読めたら見張りをやめる。** 描けた後も見張りが残ると、ちょうど 15 秒の頃に店のデータを
     * 差し替えたとき（ズーム・選択・結果の入れ替え）、差し替え中の「まだ読めていない」をつかまえて、
     * 動いている地図を案内に置き換えてしまう。
     */
    const onSourceData = (e: { sourceId?: string }) => {
      if (e.sourceId !== "shops" || !map.isSourceLoaded("shops")) return;
      clearTimeout(watchdog);
      map.off("sourcedata", onSourceData);
    };
    map.on("sourcedata", onSourceData);
    /*
     * 動いている間は枠に印を付ける。E2E が「止まった」を待つのに使う（時間では待たない）。
     * いまのズームも出しておく（E2E が「寄った・引き戻されない」を測るのに使う）。
     */
    const onMoveStart = () => (container.dataset.moving = "true");
    const onMoveEnd = () => {
      delete container.dataset.moving;
      container.dataset.zoom = map.getZoom().toFixed(2);
    };
    // 寄ったら塊を解き直す。
    const onZoomEnd = () => setZoom(map.getZoom());
    map.on("error", onError);
    map.on("movestart", onMoveStart);
    map.on("moveend", onMoveEnd);
    map.on("zoomend", onZoomEnd);
    // 「この範囲で発券」は、押した瞬間にここから読む。
    onReadyRef.current?.(() => viewBounds(map));
    // 見切れた地図を押したときに、外側のページが動いて押下が空振りしないように（#58）。
    const releaseFocus = focusWithoutScrolling(map);
    return () => {
      clearTimeout(watchdog);
      releaseFocus();
      map.off("error", onError);
      map.off("movestart", onMoveStart);
      map.off("moveend", onMoveEnd);
      map.off("zoomend", onZoomEnd);
      map.off("sourcedata", onSourceData);
      // 描けずに壊した後なら、もう壊さない。
      if (!alive) return;
      alive = false;
      map.remove();
      mapRef.current = null;
    };
    // initialBounds は名前のとおり初期値。あとから変わっても作り直さない。
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  /*
   * ピンと塊を描き直す。**ズームが変わるたびに描き直す。** 塊の大きさは画面上の距離で
   * 決まるので、寄ったら解け、引いたらまとまる。順路が変わったときも描き直す（番号はピンの中）。
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const drawing = drawShops(map, {
      shops,
      selectedId,
      route,
      onSelect: (shop, viaKeyboard) => {
        if (viaKeyboard) remember(shop.id);
        onSelectRef.current(shop);
      },
      onCluster: (group, viaKeyboard) => onClusterRef.current?.(group, viaKeyboard),
    });
    shopDrawingRef.current = drawing;
    buttonsRef.current = drawing.buttons;
    // キーボードで選んだ直後だけ、描き直したピンへ焦点を戻す。
    restore(selectedId);
    return () => {
      drawing.dispose();
      shopDrawingRef.current = null;
    };
  }, [ready, shops, zoom, selectedId, route, remember, restore]);

  /*
   * 結果が変わったら、その全体が入るところまで寄せ直す。
   *
   * **描き直し（ズーム）とは別の節にしてある。** 同じ節に置くと、ユーザーが手で寄せるたびに
   * 結果の全体へ引き戻され、地図を動かせなくなる。
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !refit) return;
    map.resize();
    map.fitBounds(shops.length > 0 ? boundsOf(shops) : JAPAN_BOUNDS, {
      padding: 24,
      maxZoom: FIT_MAX_ZOOM,
      duration: 0,
    });
  }, [shops, refit]);

  /*
   * 枠の寸法が変わったら測り直させる。全画面にして枠が伸びても、内部の寸法が古いままだと
   * 下半分が描かれない。**枠そのものを見張る**（ホストの窓の伸縮、セーフエリアの変化もある）。
   */
  useEffect(() => {
    const el = containerRef.current;
    if (!mapRef.current || !el) return;
    // 描けずに地図を壊した後は触らない（いまの地図を見る）。
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /*
   * 選んだ店へ 1 度だけ寄せる。**ズームを見ない。** 描き直しと同じ依存にすると、
   * ユーザーが引いた瞬間に選択中の店へ寄せ直され、広げる操作ができなくなる。
   */
  useEffect(() => {
    const map = mapRef.current;
    const shop = selectedId ? shops.find((s) => s.id === selectedId) : undefined;
    if (!map || !ready || !shop) return;
    map.jumpTo({ center: [shop.lon, shop.lat], zoom: Math.max(map.getZoom(), SELECT_ZOOM) });
    restore(selectedId);
    // 結果の一覧（shops）が変わっただけでは寄せ直さない。
    // oxlint-disable-next-line react/exhaustive-deps
  }, [ready, selectedId, restore]);

  // 行った印は塊の所属・位置を変えない。既存のボタンと焦点を保ち、印だけを更新する。
  useVisitedMarkers(shopDrawingRef, visitedIds);

  /*
   * 基準地点の印と同心円。**地図は動かさない。** ここで寄せると、結果の全体や順路へ寄せた
   * 直後に基準地点へ引き戻され、どこを見ているのか分からなくなる。
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !origin) return;
    return drawOrigin(map, origin);
  }, [ready, origin]);

  /*
   * 順路の線。**この節は「選んだ店へ寄せる」より後に置くこと。** 同じ更新で両方走ると、
   * 後に置いた方の地図移動が勝つ。順路を足した直後は順路の全体が見たいので、こちらが後。
   *
   * **寄せるのは順路が変わったときだけ。作り直しの 1 回目は線を引くに留める。**
   * 記録は早期 return より前で行う（空の順路で作り直されたあと、最初の 1 軒を積んだときを
   * 「1 回目」と誤解し、寄せ直しが飛んでいた）。
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const changed =
      lastRoute.current.route !== route || lastRoute.current.routeOrigin !== routeOrigin;
    lastRoute.current = { route, routeOrigin };
    if (!route || route.length === 0) return;
    const { points, clear } = drawRoute(map, route, routeOrigin);
    if (changed) {
      // 寸法を先に取り直す。初期化時の値のままだと、収まるかの判定を古い寸法で行う。
      map.resize();
      map.fitBounds(boundsOf(points), { padding: 32, maxZoom: ROUTE_MAX_ZOOM, duration: 0 });
    }
    return clear;
  }, [ready, route, routeOrigin]);

  if (cannotDraw)
    return (
      <StateNote kind="error">
        この画面では地図を描けませんでした。下の一覧から選べます。地図はブラウザで Web
        版（iekeiramen.com）を開くと使えます。
      </StateNote>
    );

  return (
    <div className={expanded ? `${styles.map} ${styles.mapExpanded}` : styles.map}>
      <div
        className={styles.mapCanvas}
        ref={containerRef}
        role="application"
        aria-label="家系ラーメン店の地図"
      />
      <MapLegend />
    </div>
  );
}
