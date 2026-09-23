import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { TASTES, type Shop } from "../lib/types";
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

/**
 * 順路の線。
 *
 * **破線なのは、道のりではないことを見た目でも示すため。** 引いているのは
 * 店と店を直線で結んだだけのもので、経路探索の結果ではない。実線にすると
 * 「この道を通る」と読めてしまう。
 */
const ROUTE_LINE = { color: SELECTED_STROKE, weight: 2, opacity: 0.55, dashArray: "6 6" };

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
}

export function MapView({ shops, selectedId, onSelect, focus, route, routeOrigin }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
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

  // 地図の生成は 1 度だけ。以降はレイヤーだけ差し替える。
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { attributionControl: true }).fitBounds(JAPAN_BOUNDS);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    // 順路は店のピンより上に置く。下だと線がピンに隠れて追えない。
    routeLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 店舗が変わったらマーカーを描き直す。
  //
  // 後始末（clearTimeout / off / clearLayers）は下の return で書いてあるが、
  // マーカーをループで作るため、検出器が登録と解除を対応づけられない。
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    // 後始末のときに ref を辿らずに済むよう、ここで掴んでおく。
    const markers = markersRef.current;

    layer.clearLayers();
    markers.clear();

    for (const shop of shops) {
      const marker = L.circleMarker([shop.lat, shop.lon], {
        radius: 6,
        color: "#ffffff",
        weight: 1.5,
        fillColor: TASTE_COLORS[shop.taste],
        fillOpacity: 0.9,
      })
        .bindTooltip(`${shop.name}（${TASTES[shop.taste].label}）`)
        .on("click", () => onSelectRef.current(shop));
      marker.addTo(layer);
      markers.set(shop.id, marker);
    }

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

    return () => {
      // 同じ tick で外れたときに、消えた地図を触りに行かないようにする。
      clearTimeout(resize);
      // 付けたハンドラは自分で外す。clearLayers だけでも参照は切れるが、
      // 「付けた側が外す」を形にしておかないと、あとで読む人に分からない。
      for (const marker of markers.values()) marker.off("click");
      layer.clearLayers();
      markers.clear();
    };
  }, [shops]);

  // 外から指定されたフォーカス位置へ移動する。
  useEffect(() => {
    if (focus && mapRef.current) {
      mapRef.current.setView([focus.lat, focus.lon], focus.zoom);
    }
  }, [focus]);

  // リストで選ばれた店舗を強調し、地図を寄せる。
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const marker = markersRef.current.get(selectedId);
    if (!marker) return;
    marker.bringToFront().setStyle({ radius: 10, color: SELECTED_STROKE, weight: 2 });
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 14));
    marker.openTooltip();
    return () => {
      marker.setStyle({ radius: 6, color: "#ffffff", weight: 1.5 });
    };
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
      className={styles.map}
      ref={containerRef}
      role="application"
      aria-label="家系ラーメン店の地図"
    />
  );
}
