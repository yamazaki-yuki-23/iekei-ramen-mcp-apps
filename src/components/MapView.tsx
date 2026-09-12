import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { TASTES, type Shop } from "../lib/types";
import styles from "../mcp-app.module.css";

/** 味の傾向ごとのピンの色。 */
const TASTE_COLORS: Record<Shop["taste"], string> = {
  rich: "#b8442c",
  creamy: "#e0a04a",
  chain: "#4a7fb8",
  unknown: "#8a8a8a",
};

/** 日本全体が収まる初期表示。 */
const JAPAN_BOUNDS = L.latLngBounds([24.0, 122.5], [45.7, 146.0]);

interface Props {
  shops: Shop[];
  selectedId?: string;
  onSelect: (shop: Shop) => void;
  /** この位置にズームする（都道府県で絞ったとき等）。 */
  focus?: { lat: number; lon: number; zoom: number };
}

export function MapView({ shops, selectedId, onSelect, focus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
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
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 店舗が変わったらマーカーを描き直す。
  useEffect(() => {
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;

    layer.clearLayers();
    markersRef.current.clear();

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
      markersRef.current.set(shop.id, marker);
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
    setTimeout(() => map.invalidateSize(), 0);
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
    marker.bringToFront().setStyle({ radius: 10, color: "#111111", weight: 2 });
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 14));
    marker.openTooltip();
    return () => {
      marker.setStyle({ radius: 6, color: "#ffffff", weight: 1.5 });
    };
  }, [selectedId]);

  return (
    <div
      className={styles.map}
      ref={containerRef}
      role="application"
      aria-label="家系ラーメン店の地図"
    />
  );
}
