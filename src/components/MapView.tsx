import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { Bounds, Shop } from "../lib/types";
import styles from "../mcp-app.module.css";
import {
  boundsOf,
  drawOrigin,
  drawRoute,
  drawShops,
  JAPAN_BOUNDS,
  ROUTE_PANE,
  SELECTED_PANE,
  toLatLngBounds,
  viewBounds,
  type MapOrigin,
} from "./map-layers";

interface Props {
  shops: Shop[];
  selectedId?: string;
  onSelect: (shop: Shop) => void;
  /** この位置にズームする（都道府県で絞ったとき等）。 */
  focus?: { lat: number; lon: number; zoom: number };
  /** 「まわる店」の順路。回る順に並んだ状態で受け取る。 */
  route?: Shop[];
  /** 順路の出発点。あれば線をここから引く。 */
  routeOrigin?: { lat: number; lon: number };
  /** 基準地点。あれば印と同心円を出す。 */
  origin?: MapOrigin;
  /** 塊を押したときに、その中身を渡す。寄っても解けない塊への逃げ道。 */
  onClusterSelect?: (shops: Shop[]) => void;
  /** 全画面のときは地図を高くする。 */
  expanded?: boolean;
  /**
   * 範囲の読み取り口を外へ渡す。
   *
   * **動かすたびに値を流さない。** 直近の移動を覚えておく形にすると、
   * 寄せ終わる前に押されたときに古い範囲で探してしまう（実際に踏んだ:
   * 塊を押した直後に「この範囲で探す」を押すと、全国 558 件のまま返った）。
   * 押した瞬間に読む。
   */
  onReady?: (getBounds: () => Bounds) => void;
  /**
   * 最初に表示する範囲。
   *
   * **payload から渡す。** 結果が差し替わるとこの部品ごと作り直されるので
   * （payload ごとに key を振ってある）、地図は毎回新品で生まれる。
   * 覚えていたつもりの画角は残らず、「この範囲で探す」の直後に日本全体へ
   * 戻ってしまう（実測: 範囲で 489 件に絞った直後、もう一度押すと 558 件）。
   */
  initialBounds?: Bounds;
  /**
   * 結果が変わったときに全体へ寄せ直すか。
   * 範囲で探し直した直後は false。ユーザーが自分で決めた画角を動かさない。
   */
  refit?: boolean;
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
  focus,
  route,
  routeOrigin,
  origin,
  onClusterSelect,
  expanded = false,
  onReady,
  initialBounds,
  refit = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  // 順路は店のマーカーとは別のレイヤーに置く。検索し直しても順路は残るので、
  // 店の描き直しで一緒に消えないようにする。
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  // 基準地点も店のマーカーとは別のレイヤー。描き直しで消えないようにする。
  const originLayerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  /*
   * 順路へ寄せたことがあるか。
   *
   * **作り直しの 1 回目は寄せない。** 範囲で探した直後は、ユーザーが決めた
   * 画角が初期表示に入っている。そこへ順路が割り込むと、見出しと結果は範囲の
   * ものなのに地図だけ順路へ飛び、もう一度「この範囲で探す」を押すと見当違いの
   * 場所を探すことになる（実測: 同じ操作の 2 回目で 3 件 → 2 件）。
   */
  const routeFitted = useRef(false);
  /*
   * いまのズーム。塊の大きさはこれで決まるので、state で持って描き直す。
   * ref だと変わっても再描画が起きず、寄っても塊が解けない。
   */
  const [zoom, setZoom] = useState(5);

  // マーカーのクリックハンドラは 1 度だけ登録するので、最新の onSelect を
  // ref 経由で参照する。ref の更新は render 中ではなく effect で行う。
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  // 塊の中身を渡す先も ref 経由。ハンドラは描き直しのたびに付け替えない。
  const onClusterRef = useRef(onClusterSelect);
  useEffect(() => {
    onClusterRef.current = onClusterSelect;
  }, [onClusterSelect]);
  // 読み取り口を渡す相手も ref 経由。親が描き直しても渡し直さない。
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // 地図の生成は 1 度だけ。以降はレイヤーだけ差し替える。
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    /*
     * **worldCopyJump で正規の世界へ戻す。** Leaflet はタイルを横に繰り返して
     * 描くが、店のピン（ベクタ層）は複製しない。隣の複製まで動かすと、地図には
     * 日本が見えているのにピンが 1 つも無い、という状態になる。
     * そのまま「この範囲で探す」を押すと当然 0 件で、理由が画面から分からない。
     */
    const map = L.map(containerRef.current, {
      attributionControl: true,
      worldCopyJump: true,
    }).fitBounds(initialBounds ? toLatLngBounds(initialBounds) : JAPAN_BOUNDS);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    /*
     * 重なり順を明示する。**レイヤーを足す前に作ること。**
     *
     *   塊・店のピン（既定の pane）< 選択中 640 < 順路の番号 645 < ツールチップ 650
     *
     * 塊は divIcon なので markerPane（600）に載り、店のピンは circleMarker で
     * overlayPane（400）に載る。別のペインは bringToFront では追い越せないので、
     * 選択中だけ上に出す。番号はさらに上——選んだ店がそのまま順路に入っている
     * ことが多く、下に潜ると何軒目か読めなくなる。
     */
    map.createPane(SELECTED_PANE).style.zIndex = "640";
    map.createPane(ROUTE_PANE).style.zIndex = "645";
    // 同心円は店のピンより下。上に置くと、線が店に重なって押しにくくなる。
    originLayerRef.current = L.layerGroup().addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    // 順路は店のピンより上に置く。下だと線がピンに隠れて追えない。
    routeLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setZoom(map.getZoom());
    // 寄ったら塊を解き直す。
    map.on("zoomend", () => setZoom(map.getZoom()));
    // 「この範囲で探す」は、押した瞬間にここから読む。
    onReadyRef.current?.(() => viewBounds(map));
    return () => {
      map.off("zoomend");
      map.remove();
      mapRef.current = null;
    };
    // initialBounds は名前のとおり初期値。あとから変わっても作り直さない。
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  /*
   * マーカーを描き直す。
   *
   * **ズームが変わるたびに描き直す。** 塊の大きさは画面上の距離で決まるので、
   * 寄ったら解け、引いたらまとまる。
   */
  useEffect(() => {
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    const markers = drawShops(layer, map, {
      shops,
      zoom,
      selectedId,
      onSelect: (shop) => onSelectRef.current(shop),
      onCluster: (group) => onClusterRef.current?.(group),
    });
    markersRef.current = markers;

    return () => {
      // 付けたハンドラは自分で外す。clearLayers だけでも参照は切れるが、
      // 「付けた側が外す」を形にしておかないと、あとで読む人に分からない。
      for (const marker of markers.values()) marker.off("click");
      layer.clearLayers();
      markers.clear();
    };
  }, [shops, zoom, selectedId]);

  /*
   * 結果が変わったら、その全体が入るところまで寄せ直す。
   *
   * **描き直し（ズーム）とは別の節にしてある。** 同じ節に置くと、ユーザーが
   * 手で寄せるたびに結果の全体へ引き戻され、地図を動かせなくなる。
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // 範囲で探し直した直後は、ユーザーが決めた画角をそのまま残す。
    if (!refit) return;
    map.fitBounds(shops.length > 0 ? boundsOf(shops) : JAPAN_BOUNDS, {
      padding: [24, 24],
      maxZoom: 14,
    });
    // 親の高さが後から確定する場合に備えて再計測する。
    const resize = setTimeout(() => map.invalidateSize(), 0);
    // 同じ tick で外れたときに、消えた地図を触りに行かないようにする。
    return () => clearTimeout(resize);
  }, [shops, refit]);

  /*
   * 枠の寸法が変わったら Leaflet に測り直させる。
   *
   * Leaflet は生成時に測った寸法を持ち続けるので、全画面にして枠が伸びても
   * 内部の寸法は古いまま。タイルが途中までしか描かれず、下半分が灰色になる。
   *
   * **全画面の切り替えを見張るのではなく、枠そのものを見張る。** 高さが変わる
   * のは全画面のときだけではない（ホストの窓の伸縮、セーフエリアの変化）。
   */
  useEffect(() => {
    const map = mapRef.current;
    const el = containerRef.current;
    if (!map || !el) return;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 外から指定されたフォーカス位置へ移動する。
  useEffect(() => {
    if (focus && mapRef.current) {
      mapRef.current.setView([focus.lat, focus.lon], focus.zoom);
    }
  }, [focus]);

  /*
   * 選んだ店へ 1 度だけ寄せる。
   *
   * **ズームを見ない。** 描き直しと同じ依存にすると、ユーザーが引いた瞬間に
   * 選択中の店へ寄せ直され、広げる操作ができなくなる。
   */
  useEffect(() => {
    const map = mapRef.current;
    const marker = selectedId ? markersRef.current.get(selectedId) : undefined;
    if (!map || !marker) return;
    marker.bringToFront().openTooltip();
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 14));
  }, [selectedId]);

  /*
   * 基準地点の印と同心円。
   *
   * **地図は動かさない。** ここで寄せると、結果の全体や順路へ寄せた直後に
   * 基準地点へ引き戻され、どこを見ているのか分からなくなる。
   */
  useEffect(() => {
    const layer = originLayerRef.current;
    if (!layer || !origin) return;
    drawOrigin(layer, origin);
    return () => {
      layer.clearLayers();
    };
  }, [origin]);

  /*
   * **この節は「選んだ店へ寄せる」より後に置くこと。** 同じ更新で両方走ると、
   * 後に置いた方の地図移動が勝つ。順路を足した直後は順路の全体が見たいので、
   * こちらが後。店を選んだだけのときは順路が変わらず、この effect は走らない。
   */
  useEffect(() => {
    const layer = routeLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    if (!route || route.length === 0) return;
    const line = drawRoute(layer, route, routeOrigin);
    const clear = () => {
      layer.clearLayers();
    };

    /*
     * 寄せるのは順路が変わったときだけ。作り直しの 1 回目は線を引くに留める。
     * refit が false のときは「ユーザーが決めた画角」なので、譲る。
     */
    const firstRunAfterMount = !routeFitted.current;
    routeFitted.current = true;
    if (firstRunAfterMount && !refit) return clear;

    /*
     * 順路の全体が入るように寄せる。直前に選んだ店へズームしたままだと、
     * 足した順路が画面の外に出て、線を引いても見えない。
     *
     * **`animate: false` は外さないこと。** 直前に「選んだ店へ寄せる」の
     * ズームが走っていると、Leaflet はアニメーション中の移動要求を捨てる。
     * 動かしたつもりで動かず、13km 離れた 2 軒目が枠の外に描かれたままになる
     * （実測: 1.5 秒待っても zoom 15・bounds は 1 軒目の周辺のまま）。
     *
     * 寸法も先に取り直す。初期化時の値を持ち続けていると、収まるかどうかの
     * 判定がその古い寸法で行われる。
     */
    map.invalidateSize();
    map.fitBounds(L.latLngBounds(line), { padding: [32, 32], maxZoom: 15, animate: false });

    return clear;
  }, [route, routeOrigin, refit]);

  return (
    <div
      className={expanded ? `${styles.map} ${styles.mapExpanded}` : styles.map}
      ref={containerRef}
      role="application"
      aria-label="家系ラーメン店の地図"
    />
  );
}
