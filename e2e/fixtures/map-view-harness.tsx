import { Marker, type Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import data from "../../data/shops.json";
import { MapView } from "../../src/features/search/components/MapView";
import type { Shop } from "../../src/types";

export interface MapTestApi {
  /** markers: 地図に置いた DOM の印（ピン・塊のボタン）の数。clusters: 塊を計算した回数。 */
  counts: { markers: number; clusters: number };
  commits: number;
  shopCount: number;
  map?: MapLibreMap;
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
  counts: { markers: 0, clusters: 0 },
  commits: 0,
  shopCount: shops.length,
  shop: shops[0],
  visit: () => {},
  filter: () => {},
};
// 印を置いた回数を数え、地図の本体もここで掴む（本番のソースは変えない）。
const addTo = Marker.prototype.addTo;
Marker.prototype.addTo = function (map: MapLibreMap) {
  window.mapTest.counts.markers++;
  window.mapTest.map = map;
  return addTo.call(this, map);
};
// 横浜駅の周り。MapLibre の 13 は Leaflet の 14 と同じ縮尺。
const focus = { lat: 35.466, lon: 139.622, zoom: 13 };

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
      initialBounds={{
        north: focus.lat + 0.02,
        south: focus.lat - 0.02,
        east: focus.lon + 0.03,
        west: focus.lon - 0.03,
      }}
      refit={false}
      onSelect={(shop) => setSelectedId(shop.id)}
      visitedIds={visited}
    />
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
