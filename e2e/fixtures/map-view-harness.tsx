import L from "leaflet";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import data from "../../data/shops.json";
import { MapView } from "../../src/components/MapView";
import type { Shop } from "../../src/lib/types";

export interface MapTestApi {
  counts: { circles: number; markers: number; clusters: number };
  commits: number;
  shopCount: number;
  map?: L.Map;
  shop: Shop;
  visit: (visited: boolean) => void;
  filter: () => void;
}
declare global {
  interface Window {
    mapTest: MapTestApi;
  }
}
const shops = data as Shop[];
window.mapTest = {
  counts: { circles: 0, markers: 0, clusters: 0 },
  commits: 0,
  shopCount: shops.length,
  shop: shops[0],
  visit: () => {},
  filter: () => {},
};
const circle = L.circleMarker;
L.circleMarker = (...args) => {
  window.mapTest.counts.circles++;
  return circle(...args);
};
const marker = L.marker;
L.marker = (...args) => {
  window.mapTest.counts.markers++;
  return marker(...args);
};
const createMap = L.map;
L.map = (...args) => {
  const map = createMap(...args);
  window.mapTest.map = map;
  return map;
};
const focus = { lat: 35.466, lon: 139.622, zoom: 14 };

function Harness() {
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string>();
  const [visibleShops, setVisibleShops] = useState(shops);
  useEffect(() => {
    window.mapTest.visit = (value) => setVisited(new Set(value ? [shops[0].id] : []));
    window.mapTest.filter = () => setVisibleShops([shops[0]]);
  }, []);
  // 子の描画effectが終わったことを待つ。固定時間のsleepでは判定しない。
  useEffect(() => {
    window.mapTest.commits++;
  });
  return (
    <MapView
      shops={visibleShops}
      selectedId={selectedId}
      focus={focus}
      refit={false}
      onSelect={(shop) => setSelectedId(shop.id)}
      visitedIds={visited}
    />
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
