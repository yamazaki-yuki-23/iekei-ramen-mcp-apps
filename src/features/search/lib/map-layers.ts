import {
  addProtocol,
  setWorkerUrl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  type ExpressionSpecification,
  type GeoJSONSource,
  type LngLatBoundsLike,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
/*
 * 描画の Worker（maplibre-gl 6 系は ES モジュールの別ファイル）を、文字として取り込んで blob: から起動する。
 * 会話の中は 1 枚の HTML で、別のファイルを置く場所が無い（そのままだと Worker を読み込めず、地図が出ない）。
 * Web 版も同じ形にそろえる。6 系に上げたのは、5 系の critical の脆弱性（GHSA-jrc7-96c5-q579）を直すため。
 */
import workerSource from "maplibre-gl/dist/maplibre-gl-worker.mjs?raw";
import { normalizeBounds } from "../utils/bounds";
import { clusterShops } from "../utils/cluster";
import { mergeStations } from "../utils/stations";
import { type Bounds, type Shop } from "../../../types";
import { TASTES } from "../../../utils/labels";
import { formatDistance } from "../../../utils/geo";
import { addMapImages, ROUTE_STOP_MAX } from "./map-images";
import { FONT_MEDIUM, LOCAL_FONTS, MAP_ATTRIBUTION, mapStyle } from "../utils/map-style";

/**
 * 地図に何をどう描くか（#246 で Leaflet から MapLibre へ）。
 *
 * **MapLibre を触る部分はここに集める。** React 側（MapView）は「いつ描くか」だけを持つ。
 *
 * **印の見た目は地図の部品（symbol 層）、押す・読み上げ・焦点は DOM のボタン。** symbol 層に
 * すると、駅名や地名がピンを避けて置かれる。ただ canvas の絵はキーボードでも読み上げでも
 * 扱えないので、同じ位置に透明なボタン（44px）を重ねる。一覧は 20 件で切れるので、地図が
 * 唯一の入口になる店がある。キーボードから押せないと、その店には辿り着けない。
 */

/**
 * 地図データと文字の置き場所。Web 版は同じ場所の `/map/`。会話の中（MCP）は、ホストが用意した
 * 別のドメインの枠で動くので、本番のドメインから取る（CSP の connectDomains に入れてある）。
 */
const MAP_BASE: string =
  import.meta.env.VITE_MAP_BASE ??
  (import.meta.env.MODE === "web" ? `${location.origin}/map/` : "https://iekeiramen.com/map/");

/** 日本全体が収まる初期表示。 */
export const JAPAN_BOUNDS: LngLatBoundsLike = [
  [122.5, 24.0],
  [146.0, 45.7],
];

/**
 * 寄せる上限。MapLibre は 512px のタイルを基準にするので、Leaflet（256px）と同じ縮尺は
 * ズームの数字が 1 小さい。今までと同じ縮尺にする（結果へ 14 → 13、順路へ 15 → 14 など）。
 */
export const FIT_MAX_ZOOM = 13;
export const ROUTE_MAX_ZOOM = 14;
export const SELECT_ZOOM = 13;
/**
 * 塊を押したときに寄る上限（Leaflet の 17 と同じ縮尺）。これ以上寄せても、塊が解けるとは
 * 限らない（5.2m しか離れていない 2 軒がある）。街の様子が見える程度で止める。
 */
const CLUSTER_ZOOM_CAP = 16;

/** 基準地点の同心円（直線距離。徒歩◯分に換算しない）。 */
const RANGE_RINGS = [500, 1000] as const;
const ORIGIN_COLOR = "#1f6f4a";

/** 基準地点。表示名は無いこともある。 */
export interface MapOrigin {
  lat: number;
  lon: number;
  label?: string;
}

let protocolAdded = false;

/**
 * この画面で、地図の描画に使う Worker（blob: から起動する ES モジュール）が動くか。小さな Worker を同じ
 * 起動の仕方で立てて、返事が来るかを見る。ホストの CSP が blob: の Worker を止めると、作る時点で例外に
 * なるか、黙って返事が来ない。6 系の地図は、Worker が動かなくても店のデータを「読めた」扱いにするので、
 * 地図の側からは見分けられない。
 */
export function canStartWorker(timeoutMs = 5_000): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob(["postMessage(1);"], { type: "text/javascript" }));
    let worker: Worker;
    try {
      worker = new Worker(url, { type: "module" });
    } catch {
      URL.revokeObjectURL(url);
      resolve(false);
      return;
    }
    const done = (ok: boolean) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    worker.addEventListener("message", () => done(true));
    worker.addEventListener("error", () => done(false));
  });
}

/** 地図を作る。重なり順の層もここで作る（店・順路・基準地点のデータは後から差し替える）。 */
export function createMap(
  container: HTMLElement,
  initial: Bounds | undefined,
  /** 店のピンを重ねる層ができたとき（背景の地図データを待たない）。 */
  onOverlaysReady: () => void,
): MapLibreMap {
  if (!protocolAdded) {
    addProtocol("pmtiles", new Protocol().tile);
    protocolAdded = true;
  }
  /*
   * 描画の Worker の URL は、地図を作るたびに作って、作り終えたら捨てる。地図の部品は、地図を作る時点で
   * Worker をまとめて立て、ブラウザは立てるときに URL を読み取るので、その後は要らない。
   */
  const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  setWorkerUrl(workerUrl);
  const map = new MapLibreMap({
    container,
    style: mapStyle(MAP_BASE),
    bounds: initial ? toLngLatBounds(initial) : JAPAN_BOUNDS,
    maxZoom: 18,
    minZoom: 2,
    // 回転・傾きは使わない（北が上の地図だけを読む）。
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    /*
     * **世界を横に繰り返さない。** Leaflet で、隣の複製まで動かすと地図には日本が見えているのに
     * ピンが 1 つも無い、という状態があった（そのまま「この範囲で発券」を押すと 0 件）。
     */
    renderWorldCopies: false,
    /*
     * 出典は最初から畳んだ「i」にする（開いたままだと、下の端のピンに重なる）。地図データが
     * 取れなかったときも出るよう、データの側ではなく出典の欄に直接書く。
     */
    attributionControl: { compact: true, customAttribution: MAP_ATTRIBUTION },
    localIdeographFontFamily: LOCAL_FONTS,
    fadeDuration: 0,
    // 地図のボタンの名前（読み上げ・触れたときの説明）を日本語にする。
    locale: {
      "NavigationControl.ZoomIn": "拡大",
      "NavigationControl.ZoomOut": "縮小",
      "AttributionControl.ToggleAttribution": "出典を開く・閉じる",
      "Map.Title": "地図",
    },
  });
  URL.revokeObjectURL(workerUrl);
  // 出典の欄は、作った直後は開いている（動かすと畳む作り）。最初から畳んだ「i」にする。
  const credit = container.querySelector(".maplibregl-ctrl-attrib");
  credit?.classList.remove("maplibregl-compact-show");
  credit?.removeAttribute("open");
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new NavigationControl({ showCompass: false }), "top-left");
  // 絵はスタイルの読み込みとは別に足す。足りない絵を求められたら、その場で全部足す。
  map.on("styleimagemissing", () => addMapImages(map));
  /*
   * **重ねる層は、スタイルを読んだ時点で足す**（load を待たない）。load は背景の地図データが
   * 届くまで来ないので、地図データが取れない（R2 が落ちている、CSP で止められた）と、
   * 店のピンまで出なくなる。
   */
  map.once("style.load", () => {
    addOverlays(map);
    onOverlaysReady();
  });
  return map;
}

/** 重ねる層に渡す GeoJSON の形（点と線だけ）。geojson の型の依存を足さないため、ここで持つ。 */
type Position = number[];
type Point = { type: "Point"; coordinates: Position };
type Geometry = Point | { type: "LineString"; coordinates: Position[] };
type Feature<G extends Geometry = Geometry> = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: G;
};
type FeatureCollection = { type: "FeatureCollection"; features: Feature[] };

const empty: FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * 重ねる層のデータ源。**地図を壊した後は undefined。** 結果が入れ替わると地図ごと作り直され、
 * 地図を先に壊してから、順路の線や基準地点を消す後片付けが走る（壊れた地図に触ると例外で落ちる）。
 */
function source(map: MapLibreMap, id: string): GeoJSONSource | undefined {
  if (!(map as unknown as { style?: unknown }).style) return undefined;
  return map.getSource(id) as GeoJSONSource | undefined;
}

/**
 * 背景の上に重ねる層。下から: 基準地点の円 < 順路の線 < 駅の札 < 選択中の店名 < 塊 < 店のピン
 * < 味の言葉 < 行った印 < 選択中（デザイナーの見本と同じ）。
 *
 * **地図の部品は上の層から先に置かれる。** ピンを上に置くと、駅の札と店名はピンを避けて
 * 空いた所へ出る。選択中のしずく形は場所を取らない（取らせると、店名がどこにも置けない）。
 */
function addOverlays(map: MapLibreMap) {
  addMapImages(map);
  for (const id of ["origin", "route", "stations", "shops"])
    map.addSource(id, { type: "geojson", data: empty });
  map.addLayer({
    id: "origin-ring",
    type: "line",
    source: "origin",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: {
      "line-color": ORIGIN_COLOR,
      "line-opacity": 0.5,
      "line-width": 1,
      "line-dasharray": [4, 6],
    },
  });
  map.addLayer({
    id: "origin-point",
    type: "circle",
    source: "origin",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 5,
      "circle-color": ORIGIN_COLOR,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  /*
   * 順路の線。**破線なのは、道のりではないことを見た目でも示すため。** 店と店を直線で
   * 結んだだけで、経路探索の結果ではない。実線にすると「この道を通る」と読めてしまう。
   */
  map.addLayer({
    id: "route-line",
    type: "line",
    source: "route",
    paint: {
      "line-color": "#141312",
      "line-opacity": 0.55,
      "line-width": 2,
      "line-dasharray": [3, 3],
    },
  });
  map.addLayer({
    id: "station",
    type: "symbol",
    source: "stations",
    minzoom: 11.5,
    filter: ["<=", ["get", "mz"], ["max", 11, ["-", ["zoom"], 1]]],
    layout: {
      "text-variable-anchor": ["center", "top", "bottom", "left", "right"],
      "text-radial-offset": 1.4,
      "icon-text-fit-padding": [2, 6, 4, 6],
      "text-field": ["get", "n"],
      "text-font": FONT_MEDIUM,
      "text-size": ["interpolate", ["linear"], ["zoom"], 12, 11.5, 16, 12.5],
      "icon-image": "key",
      "icon-text-fit": "both",
      "symbol-sort-key": ["get", "mz"],
      "text-padding": 8,
    },
    paint: { "text-color": "#4a4640" },
  });
  const single: ExpressionSpecification = ["==", ["get", "kind"], "shop"];
  const selected: ExpressionSpecification = ["==", ["get", "selected"], true];
  map.addLayer({
    id: "selected-name",
    type: "symbol",
    source: "shops",
    filter: ["all", single, selected],
    layout: {
      "text-field": ["get", "name"],
      "text-font": FONT_MEDIUM,
      "text-size": 14,
      "text-variable-anchor": ["top", "left", "right"],
      "text-radial-offset": 0.5,
      "text-padding": 0,
    },
    paint: { "text-color": "#22150e", "text-halo-color": "#ffffff", "text-halo-width": 3 },
  });
  map.addLayer({
    id: "clusters",
    type: "symbol",
    source: "shops",
    filter: ["==", ["get", "kind"], "cluster"],
    layout: {
      "icon-image": ["step", ["get", "count"], "cluster-s", 10, "cluster-m", 50, "cluster-l"],
      "icon-allow-overlap": true,
      "text-field": ["to-string", ["get", "count"]],
      "text-font": FONT_MEDIUM,
      "text-size": 15,
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#ffffff" },
  });
  map.addLayer({
    id: "pins",
    type: "symbol",
    source: "shops",
    filter: ["all", single, ["!", selected]],
    layout: {
      "icon-image": [
        "case",
        [">", ["get", "stop"], 0],
        ["concat", "stop-", ["get", "taste"], "-", ["to-string", ["get", "stop"]]],
        ["concat", "pin-", ["get", "taste"]],
      ],
      "icon-allow-overlap": true,
      "symbol-sort-key": ["get", "order"],
    },
  });
  // 味の言葉。ほかの印と重なるときは言葉だけ省く（ピンは必ず出す）。未判定には添えない。
  map.addLayer({
    id: "taste-word",
    type: "symbol",
    source: "shops",
    filter: ["all", single, ["!", selected], ["!=", ["get", "taste"], "unknown"]],
    layout: {
      "icon-image": ["concat", "word-", ["get", "taste"]],
      "icon-anchor": "top",
      "icon-offset": [0, 17],
    },
  });
  map.addLayer({
    id: "visited",
    type: "symbol",
    source: "shops",
    filter: ["all", single, ["==", ["get", "visited"], true]],
    layout: {
      "icon-image": "visited",
      // ピンの中心から右に 13px・上に 13px。しずく形（先端が店の位置）は右に 17px・上に 40px。
      "icon-offset": ["case", selected, ["literal", [17, -40]], ["literal", [13, -13]]],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
  map.addLayer({
    id: "selected",
    type: "symbol",
    source: "shops",
    filter: ["all", single, selected],
    layout: {
      "icon-image": [
        "case",
        [">", ["get", "stop"], 0],
        ["concat", "sel-", ["get", "taste"], "-", ["to-string", ["get", "stop"]]],
        ["concat", "sel-", ["get", "taste"]],
      ],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-anchor": "bottom",
      "icon-offset": [0, 2],
    },
  });
  map.on("idle", () => updateStations(map));
}

const stationKey = new WeakMap<MapLibreMap, string>();

/** 駅の札。いま読めている地図データの駅をまとめて出す（まとめ方は utils/stations.ts）。 */
function updateStations(map: MapLibreMap) {
  if (!map.getSource("basemap") || !map.getSource("stations") || map.getZoom() < 11.5) return;
  const raw = map.querySourceFeatures("basemap", {
    sourceLayer: "pois",
    filter: ["==", ["get", "kind"], "station"],
  });
  const { stations, key } = mergeStations(
    raw.flatMap((f) =>
      f.geometry.type === "Point"
        ? [
            {
              name: f.properties?.name,
              nameJa: f.properties?.["name:ja"],
              minZoom: f.properties?.min_zoom,
              lon: f.geometry.coordinates[0],
              lat: f.geometry.coordinates[1],
            },
          ]
        : [],
    ),
  );
  if (key === stationKey.get(map)) return;
  stationKey.set(map, key);
  source(map, "stations")?.setData({
    type: "FeatureCollection",
    features: stations.map(({ n, mz, lon, lat }) => ({
      type: "Feature",
      properties: { n, mz },
      geometry: { type: "Point", coordinates: [lon, lat] },
    })),
  });
}

/** いま地図に出ている範囲。丸め方は [bounds.ts](../utils/bounds.ts) に隔離してある。 */
export function viewBounds(map: MapLibreMap): Bounds {
  const b = map.getBounds();
  return normalizeBounds({
    north: b.getNorth(),
    south: b.getSouth(),
    east: b.getEast(),
    west: b.getWest(),
  });
}

/** 点の一覧を囲む枠。 */
export function boundsOf(points: Array<{ lat: number; lon: number }>): LngLatBoundsLike {
  const lons = points.map((p) => p.lon);
  const lats = points.map((p) => p.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

/** payload から来た範囲を MapLibre の形に直す。 */
function toLngLatBounds(bounds: Bounds): LngLatBoundsLike {
  return [
    [bounds.west, bounds.south],
    [bounds.east, bounds.north],
  ];
}

/**
 * 地図の上で押したときに、外側のページをスクロールさせない（#58）。地図に焦点が無いときに
 * 押されると、ブラウザは焦点を移すついでに枠を見せようとして祖先をスクロールし、押してから
 * 離すまでの間に中身がずれて、押下が空振りする。先に、スクロールさせずに焦点を置く。
 * ピンや塊のボタンを押したときは、ボタンに焦点を任せる。
 */
export function focusWithoutScrolling(map: MapLibreMap): () => void {
  const canvas = map.getCanvas();
  const container = map.getContainer();
  const onPress = (e: Event) => {
    if ((e.target as Element).closest("button")) return;
    if (document.activeElement !== canvas) canvas.focus({ preventScroll: true });
  };
  container.addEventListener("mousedown", onPress, true);
  return () => container.removeEventListener("mousedown", onPress, true);
}

/** キーボードの Enter・Space で押すと click の detail は 0。 */
const viaKeyboard = (e: MouseEvent) => e.detail === 0;

function shopLabel(shop: Shop, visited: boolean): string {
  return `${shop.name}（${TASTES[shop.taste].label}${visited ? "・行った店" : ""}）`;
}

/** ピンに触れたときの札（食券と同じ形）。店名（太字）／味（参考）・直線距離・行った店。 */
function tipContent(shop: Shop, visited: boolean): HTMLElement {
  const el = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = shop.name;
  const sub = document.createElement("span");
  const parts = [
    shop.taste === "unknown" ? "味はまだ分けていない" : `${TASTES[shop.taste].label}（参考）`,
  ];
  if (shop.distanceKm !== undefined) parts.push(`直線 ${formatDistance(shop.distanceKm)}`);
  if (visited) parts.push("行った店");
  sub.textContent = parts.join("・");
  el.appendChild(name);
  el.appendChild(sub);
  return el;
}

/**
 * 店のピンと塊を描く。近すぎるものは塊にまとめる（選んだ店と順路の店はまとめない。
 * 選んだ手応えと、何軒目かの番号が消えないように）。
 *
 * 描いた後は、店 → ボタンの対応表と、行った印だけを更新する口を返す。
 */
export function drawShops(
  map: MapLibreMap,
  opts: {
    shops: Shop[];
    selectedId?: string;
    route?: Shop[];
    onSelect: (shop: Shop, viaKeyboard: boolean) => void;
    /** 塊を押したときに、その中身を外へ渡す。キーボード由来かも伝える。 */
    onCluster: (shops: Shop[], viaKeyboard: boolean) => void;
  },
) {
  const stops = new Map((opts.route ?? []).map((s, i) => [s.id, i + 1]));
  const keep = new Set([...stops.keys(), ...(opts.selectedId ? [opts.selectedId] : [])]);
  /*
   * **いまの結果に無い順路の店も描く。** 順路は検索をまたいで残り、線は全部の店まで引くので、
   * 結果から外れた店の番号が無いと、線の端に何も無くなる。
   */
  const shown = new Set(opts.shops.map((s) => s.id));
  const shops = [...opts.shops, ...(opts.route ?? []).filter((s) => !shown.has(s.id))];
  // 塊の計算は 256px のタイル基準（Leaflet と同じ見え方）。MapLibre のズームに 1 を足す。
  const clusters = clusterShops(shops, map.getZoom() + 1, keep);
  const buttons = new Map<string, HTMLButtonElement>();
  const markers: Marker[] = [];
  const tip = new Popup({
    closeButton: false,
    closeOnClick: false,
    className: "map-tip",
    offset: 24,
    maxWidth: "260px",
  });
  let visitedIds: ReadonlySet<string> | undefined;
  // いま札を出している店。行った印が変わったら、札の中身も書き直す。
  let tipShop: Shop | undefined;
  const showTip = (shop: Shop) => {
    tipShop = shop;
    tip
      .setLngLat([shop.lon, shop.lat])
      .setDOMContent(tipContent(shop, visitedIds?.has(shop.id) ?? false))
      .addTo(map);
  };
  const hideTip = () => {
    tipShop = undefined;
    tip.remove();
  };
  const features: Feature[] = [];

  const place = (el: HTMLElement, lat: number, lon: number) => {
    markers.push(new Marker({ element: el }).setLngLat([lon, lat]).addTo(map));
  };

  clusters.forEach((cluster, order) => {
    if (cluster.shops.length === 1) {
      const shop = cluster.shops[0];
      const isSelected = shop.id === opts.selectedId;
      const stop = stops.get(shop.id) ?? 0;
      features.push({
        type: "Feature",
        properties: {
          kind: "shop",
          id: shop.id,
          name: shop.name,
          taste: shop.taste,
          selected: isSelected,
          stop: stop <= ROUTE_STOP_MAX ? stop : 0,
          visited: false,
          // 未判定 < 味の分かる店 < 順路の店 の順に上へ重ねる。
          order: stop > 0 ? 2 : shop.taste === "unknown" ? 0 : 1,
        },
        geometry: { type: "Point", coordinates: [shop.lon, shop.lat] },
      });
      /*
       * いまの結果に無い順路の店は、押せない印にする（Leaflet の頃の順路の番号と同じ）。押しても
       * 一覧に無いので、詳細も行き先も出せない。番号と読み上げの名前だけを持つ。
       */
      if (!shown.has(shop.id)) {
        const mark = document.createElement("span");
        mark.className = "route-stop-pin";
        mark.setAttribute("role", "img");
        mark.setAttribute("aria-label", `まわる店の ${stop} 軒目: ${shop.name}（いまの結果の外）`);
        mark.dataset.stop = String(stop);
        place(mark, shop.lat, shop.lon);
        return;
      }
      const el = document.createElement("button");
      el.type = "button";
      el.className = isSelected ? "shop-pin shop-pin-selected" : "shop-pin";
      el.setAttribute("aria-label", shopLabel(shop, false));
      if (isSelected) el.setAttribute("aria-current", "true");
      if (stop > 0) el.dataset.stop = String(stop);
      el.addEventListener("click", (e) => opts.onSelect(shop, viaKeyboard(e)));
      el.addEventListener("pointerenter", () => showTip(shop));
      el.addEventListener("focus", () => showTip(shop));
      el.addEventListener("pointerleave", hideTip);
      el.addEventListener("blur", hideTip);
      buttons.set(shop.id, el);
      place(el, shop.lat, shop.lon);
      return;
    }

    features.push({
      type: "Feature",
      properties: { kind: "cluster", count: cluster.shops.length, order },
      geometry: { type: "Point", coordinates: [cluster.lon, cluster.lat] },
    });
    /*
     * 塊を押すと、その塊が画面いっぱいになるまで寄り、**中身を一覧にも出す。** 寄れば解ける
     * とは限らない（5.2m しか離れていない 2 軒がある）。**動きを付けない**（動いている途中に
     * 「この範囲で発券」を押されると、中途半端な画角で探してしまう）。**引き戻さない**
     * （すでに上限より寄っているところで押したら、いまより遠くへは行かせない）。
     */
    const el = document.createElement("button");
    el.type = "button";
    el.className = "cluster-pin";
    el.textContent = String(cluster.shops.length);
    el.setAttribute("aria-label", `この地点の ${cluster.shops.length} 軒を開く`);
    el.addEventListener("click", (e) => {
      map.fitBounds(boundsOf(cluster.shops), {
        padding: 32,
        maxZoom: Math.max(map.getZoom(), CLUSTER_ZOOM_CAP),
        duration: 0,
      });
      opts.onCluster(cluster.shops, viaKeyboard(e));
    });
    place(el, cluster.lat, cluster.lon);
  });

  const setData = () =>
    source(map, "shops")?.setData({
      type: "FeatureCollection",
      features,
    });
  setData();

  return {
    buttons,
    dispose() {
      hideTip();
      for (const marker of markers) marker.remove();
      buttons.clear();
    },
    updateVisited(next?: ReadonlySet<string>) {
      if (next === visitedIds) return;
      visitedIds = next;
      const byId = new Map(shops.map((s) => [s.id, s]));
      for (const f of features) {
        const p = f.properties;
        if (p.kind !== "shop" || typeof p.id !== "string") continue;
        const visited = next?.has(p.id) ?? false;
        if (p.visited === visited) continue;
        p.visited = visited;
        const el = buttons.get(p.id);
        const shop = byId.get(p.id);
        if (el && shop) {
          el.setAttribute("aria-label", shopLabel(shop, visited));
          el.dataset.visited = String(visited);
        }
      }
      setData();
      if (tipShop) showTip(tipShop);
    },
  };
}

/** 中心から半径 m の円（64 角形）。 */
function circle(lat: number, lon: number, m: number): Position[] {
  const dLat = m / 111_320;
  const dLon = m / (111_320 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: 65 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2;
    return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)];
  });
}

/** 基準地点の印と同心円。**地図は動かさない。** 後片付けの関数を返す。 */
export function drawOrigin(map: MapLibreMap, origin: MapOrigin): () => void {
  source(map, "origin")?.setData({
    type: "FeatureCollection",
    features: [
      ...RANGE_RINGS.map((r): Feature => ({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: circle(origin.lat, origin.lon, r) },
      })),
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [origin.lon, origin.lat] },
      },
    ],
  });
  // 基準地点の名前は、触れたときと読み上げにも出す（印は canvas なので届かない）。
  const label = origin.label ? `基準地点: ${origin.label}` : "基準地点";
  const el = document.createElement("span");
  el.className = "origin-pin";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", label);
  el.title = label;
  const marker = new Marker({ element: el }).setLngLat([origin.lon, origin.lat]).addTo(map);
  return () => {
    marker.remove();
    source(map, "origin")?.setData(empty);
  };
}

/**
 * 順路の線。番号はピンの中に描く（drawShops の stop）。
 * 戻り値の points は線が通る点。呼ぶ側がここへ寄せるのに使う。
 */
export function drawRoute(
  map: MapLibreMap,
  route: Shop[],
  origin?: { lat: number; lon: number },
): { points: Array<{ lat: number; lon: number }>; clear: () => void } {
  const points = origin ? [origin, ...route] : route;
  source(map, "route")?.setData(
    points.length > 1
      ? {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: points.map((p) => [p.lon, p.lat]) },
        }
      : empty,
  );
  return { points, clear: () => source(map, "route")?.setData(empty) };
}
