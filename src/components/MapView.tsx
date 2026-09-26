import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { clusterShops } from "../lib/cluster";
import { TASTES, type Bounds, type Shop } from "../lib/types";
import styles from "../mcp-app.module.css";

/**
 * 味の傾向ごとのピンの色。
 *
 * Leaflet は CSS 変数を受け取らないので、ここだけ実値を持つ。
 * global.css のパレットから取っている（rich = --ramen-600、
 * unknown = --gray-500）ので、パレットを変えたらここも合わせる。
 */
const TASTE_COLORS: Record<Shop["taste"], string> = {
  rich: "#b8442c",
  creamy: "#e0a04a",
  chain: "#4a7fb8",
  unknown: "#7d776e",
};

/** 選択中のピンの縁。地図タイルのどの色の上でも輪郭が出る濃さ。 */
const SELECTED_STROKE = "#141312";

/** 店 1 軒のピン。選択中だけ大きく、縁を濃くする。 */
const PIN = { radius: 6, color: "#ffffff", weight: 1.5 } as const;
const PIN_SELECTED = { radius: 10, color: SELECTED_STROKE, weight: 2 } as const;

/**
 * 順路の線。
 *
 * **破線なのは、道のりではないことを見た目でも示すため。** 引いているのは
 * 店と店を直線で結んだだけのもので、経路探索の結果ではない。実線にすると
 * 「この道を通る」と読めてしまう。
 */
const ROUTE_LINE = { color: SELECTED_STROKE, weight: 2, opacity: 0.55, dashArray: "6 6" };

/**
 * いま地図に出ている範囲。
 *
 * **±180 / ±90 に丸める。** 引ききると Leaflet は世界を繰り返して数えるので、
 * 経度が 200 度などになる。そのままサーバーへ渡すとスキーマで弾かれる。
 */
const clampLat = (v: number) => Math.max(-90, Math.min(90, v));
const clampLon = (v: number) => Math.max(-180, Math.min(180, v));

function viewBounds(map: L.Map): Bounds {
  const b = map.getBounds();
  return {
    north: clampLat(b.getNorth()),
    south: clampLat(b.getSouth()),
    east: clampLon(b.getEast()),
    west: clampLon(b.getWest()),
  };
}

/** 日本全体が収まる初期表示。 */
const JAPAN_BOUNDS = L.latLngBounds([24.0, 122.5], [45.7, 146.0]);

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

export function MapView({
  shops,
  selectedId,
  onSelect,
  focus,
  route,
  routeOrigin,
  expanded = false,
  onReady,
  initialBounds,
  refit = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  /*
   * いまのズーム。塊の大きさはこれで決まるので、state で持って描き直す。
   * ref だと変わっても再描画が起きず、寄っても塊が解けない。
   */
  const [zoom, setZoom] = useState(5);
  const layerRef = useRef<L.LayerGroup | null>(null);
  // 順路は店のマーカーとは別のレイヤーに置く。検索し直しても順路は残るので、
  // 店の描き直しで一緒に消えないようにする。
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  // マーカーのクリックハンドラは 1 度だけ登録するので、最新の onSelect を
  // ref 経由で参照する。ref の更新は render 中ではなく effect で行う。
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  // 読み取り口を渡す相手も ref 経由。親が描き直しても渡し直さない。
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // 地図の生成は 1 度だけ。以降はレイヤーだけ差し替える。
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { attributionControl: true }).fitBounds(
      initialBounds
        ? L.latLngBounds(
            [initialBounds.south, initialBounds.west],
            [initialBounds.north, initialBounds.east],
          )
        : JAPAN_BOUNDS,
    );
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    // 順路は店のピンより上に置く。下だと線がピンに隠れて追えない。
    routeLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setZoom(map.getZoom());
    // 寄ったら塊を解き直す。動かしただけ（moveend）では塊は変わらない。
    map.on("zoomend", () => setZoom(map.getZoom()));
    // 「この範囲で探す」は、押した瞬間にここから読む。
    onReadyRef.current?.(() => viewBounds(map));
    return () => {
      map.off("zoomend");
      map.remove();
      mapRef.current = null;
    };
    // initialBounds は名前のとおり初期値。あとから変わっても作り直さない。
    // react-doctor-disable-next-line react-doctor/exhaustive-effect-dependencies
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  /*
   * マーカーを描き直す。
   *
   * 近すぎる店は塊にまとめる（[src/lib/cluster.ts](../lib/cluster.ts)）。
   * 東京 162 件が重なると、何軒あるのかも、どれを押しているのかも分からない。
   *
   * **ズームが変わるたびに描き直す。** 塊の大きさは画面上の距離で決まるので、
   * 寄ったら解け、引いたらまとまる。
   */
  // マーカーをループで作るため、検出器が登録と解除を対応づけられない。
  // 後始末は下の return に書いてある。
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    // 後始末のときに ref を辿らずに済むよう、ここで掴んでおく。
    const markers = markersRef.current;

    layer.clearLayers();
    markers.clear();

    for (const cluster of clusterShops(shops, zoom, selectedId)) {
      // 1 軒だけの塊は、ふつうの店のピンとして描く。
      if (cluster.shops.length === 1) {
        const shop = cluster.shops[0];
        const marker = L.circleMarker([shop.lat, shop.lon], {
          ...(shop.id === selectedId ? PIN_SELECTED : PIN),
          fillColor: TASTE_COLORS[shop.taste],
          fillOpacity: 0.9,
        })
          .bindTooltip(`${shop.name}（${TASTES[shop.taste].label}）`)
          .on("click", () => onSelectRef.current(shop));
        marker.addTo(layer);
        markers.set(shop.id, marker);
        continue;
      }

      /*
       * 塊は件数を出す。押すと、その塊が画面いっぱいになるまで寄る。
       *
       * 何軒か分からない丸を押させると、開いてみるまで何が起きるか読めない。
       * 番号（.routePin）と紛れないよう、面ではなく縁で色を持たせている。
       */
      const bounds = L.latLngBounds(cluster.shops.map((s) => [s.lat, s.lon] as [number, number]));
      L.marker([cluster.lat, cluster.lon], {
        icon: L.divIcon({
          /*
           * CSS モジュールのクラス名は毎ビルド変わるので、掴む先として
           * 素のクラスも 1 つ付けておく（E2E が塊だけを数えるため）。
           */
          className: `${styles.clusterPin} cluster-pin`,
          html: String(cluster.shops.length),
          iconSize: [36, 36],
        }),
        // 読み上げは一覧が担う。地図の塊はここでは名前を持たない。
        keyboard: false,
      })
        /*
         * **アニメーションさせない。** 動いている途中に「この範囲で探す」を
         * 押されると、中途半端な画角で探してしまう。DESIGN.md の
         * 「アニメーションで情報を伝えない」にも合う。
         */
        .on("click", () =>
          map.fitBounds(bounds, { padding: [32, 32], maxZoom: 17, animate: false }),
        )
        .addTo(layer);
    }

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
    if (shops.length > 0) {
      map.fitBounds(L.latLngBounds(shops.map((s) => [s.lat, s.lon] as [number, number])), {
        padding: [24, 24],
        maxZoom: 14,
      });
    } else {
      map.fitBounds(JAPAN_BOUNDS);
    }
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
   * **この節は「選んだ店へ寄せる」より後に置くこと。** 同じ更新で両方走ると、
   * 後に置いた方の地図移動が勝つ。順路を足した直後は順路の全体が見たいので、
   * こちらが後。店を選んだだけのときは順路が変わらず、この effect は走らない。
   */
  /*
   * 順路の線と番号。
   *
   * 番号は divIcon（ただの HTML）で描く。Leaflet の既定アイコンは PNG を
   * 外部参照するので、単一 HTML に固められない（CLAUDE.md の制約）。
   */
  // 線とマーカーをループで足すため、検出器が登録と解除を対応づけられない。
  // 後始末は下の return に書いてある。
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    const layer = routeLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();
    if (!route || route.length === 0) return;

    const points: Array<[number, number]> = route.map((s) => [s.lat, s.lon]);
    // 出発点が分かっているなら、そこから 1 軒目までも引く。
    const line = routeOrigin
      ? [[routeOrigin.lat, routeOrigin.lon] as [number, number], ...points]
      : points;
    if (line.length > 1) L.polyline(line, ROUTE_LINE).addTo(layer);

    route.forEach((shop, i) => {
      L.marker([shop.lat, shop.lon], {
        icon: L.divIcon({
          className: styles.routePin,
          html: String(i + 1),
          iconSize: [24, 24],
        }),
        // 番号は順路を読むためのもの。押す先は店のピンに任せる。
        interactive: false,
        keyboard: false,
      }).addTo(layer);
    });

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

    return () => {
      layer.clearLayers();
    };
  }, [route, routeOrigin]);

  return (
    <div
      className={expanded ? `${styles.map} ${styles.mapExpanded}` : styles.map}
      ref={containerRef}
      role="application"
      aria-label="家系ラーメン店の地図"
    />
  );
}
