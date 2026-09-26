import L from "leaflet";
import { normalizeBounds } from "../lib/bounds";
import { clusterShops } from "../lib/cluster";
import { TASTES, type Bounds, type Shop } from "../lib/types";
import styles from "../mcp-app.module.css";

/**
 * 地図に何をどう描くか。
 *
 * **Leaflet を触る部分はここに集める。** React 側（MapView）は「いつ描くか」
 * だけを持つ。混ぜると、地図の生成・後始末と画面の都合が同じ関数に溜まる。
 *
 * Leaflet は CSS 変数を受け取らないので、色の実値もここだけが持つ。
 * global.css のパレットから取っているので、パレットを変えたらここも合わせる。
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
 * 選択中のピンを置くペイン。
 *
 * **塊（divIcon）は markerPane（z-index 600）に、店のピン（circleMarker）は
 * overlayPane（400）に載る。** 別のペインなので bringToFront では追い越せず、
 * 選んだ店が 36px の塊に覆われて見えなくなる。実測で、選んだ 1 軒と残りの塊の
 * 中心が 0.4〜3.3px（zoom 12〜15）＝ほぼ同じ位置に来る組があった。
 * 選択中だけ上のペインに出して、`keepId` の約束（選んだ店は必ず見える）を守る。
 */
export const SELECTED_PANE = "selectedShop";

/**
 * 順路の番号を置くペイン。
 *
 * **選択中のピンより上。** 番号は「何軒目か」を読むためのもので、選んだ店が
 * そのまま順路に入っていることも多い。選択のペインを上げたとき、ここを
 * 決めておかないと番号が選択ピンの下に潜る（元は markerPane で上にあった）。
 */
export const ROUTE_PANE = "routeOrder";

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
 * 基準地点の印と同心円。
 *
 * **半径は直線距離。徒歩◯分に換算しない**（経路探索のデータを持っていない。
 * 時間を出すと「間に合うか」の判断材料に化ける）。500m と 1km にしてあるのは、
 * 歩くかどうかを決める境目がこのあたりだから。
 */
const RANGE_RINGS = [500, 1000] as const;
const ORIGIN_COLOR = "#1f6f4a";
const RING = { color: ORIGIN_COLOR, weight: 1, opacity: 0.5, fill: false, dashArray: "4 6" };

/** 日本全体が収まる初期表示。 */
export const JAPAN_BOUNDS = L.latLngBounds([24.0, 122.5], [45.7, 146.0]);

/**
 * 文字として出すツールチップの中身。
 *
 * **文字列を渡さない。** Leaflet は渡された文字列を HTML として描くので、
 * 店名や地名に markup が入っていればそのまま解釈される。基準地点の表示名は
 * tool の引数と geocode の結果（どちらも外から来る）なので、素通しにできない。
 */
function textTooltip(text: string): HTMLElement {
  const el = document.createElement("span");
  el.textContent = text;
  return el;
}

/** 基準地点。表示名は無いこともある。 */
export interface MapOrigin {
  lat: number;
  lon: number;
  label?: string;
}

/** いま地図に出ている範囲。丸め方は [bounds.ts](../lib/bounds.ts) に隔離してある。 */
export function viewBounds(map: L.Map): Bounds {
  const b = map.getBounds();
  return normalizeBounds({
    north: b.getNorth(),
    south: b.getSouth(),
    east: b.getEast(),
    west: b.getWest(),
  });
}

/** 店の一覧を囲む枠。 */
export function boundsOf(points: Array<{ lat: number; lon: number }>): L.LatLngBounds {
  return L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number]));
}

/** payload から来た範囲を Leaflet の形に直す。 */
export function toLatLngBounds(bounds: Bounds): L.LatLngBounds {
  return L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]);
}

/**
 * 店のピンを描く。近すぎるものは塊にまとめる。
 *
 * 戻り値は「店 ID → ピン」の対応。選んだ店へ寄せるときに使う
 * （塊にまとめた店は単独のピンを持たないので、ここには入らない）。
 */
export function drawShops(
  layer: L.LayerGroup,
  map: L.Map,
  opts: {
    shops: Shop[];
    zoom: number;
    selectedId?: string;
    onSelect: (shop: Shop) => void;
    /** 塊を押したときに、その中身を外へ渡す。 */
    onCluster: (shops: Shop[]) => void;
  },
): Map<string, L.CircleMarker> {
  const markers = new Map<string, L.CircleMarker>();

  for (const cluster of clusterShops(opts.shops, opts.zoom, opts.selectedId)) {
    // 1 軒だけの塊は、ふつうの店のピンとして描く。
    if (cluster.shops.length === 1) {
      const shop = cluster.shops[0];
      const marker = L.circleMarker([shop.lat, shop.lon], {
        ...(shop.id === opts.selectedId ? { ...PIN_SELECTED, pane: SELECTED_PANE } : PIN),
        fillColor: TASTE_COLORS[shop.taste],
        fillOpacity: 0.9,
      })
        .bindTooltip(textTooltip(`${shop.name}（${TASTES[shop.taste].label}）`))
        .on("click", () => opts.onSelect(shop));
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
    const bounds = boundsOf(cluster.shops);
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
       * 寄るだけでなく、**中身を一覧にも出す。**
       *
       * 寄れば解ける、とは限らない。実データには 5.2m しか離れていない 2 軒が
       * あり（ろくの家 / 稲和家ラーメン）、地図の最大ズーム 19 でも 21.1px で、
       * まとめる下限 36px を下回ったままになる。寄せるだけだと、その 2 軒は
       * 地図から永久に選べない。押した塊の中身は必ず一覧に出す。
       *
       * **アニメーションさせない。** 動いている途中に「この範囲で探す」を
       * 押されると、中途半端な画角で探してしまう。DESIGN.md の
       * 「アニメーションで情報を伝えない」にも合う。
       */
      .on("click", () => {
        map.fitBounds(bounds, { padding: [32, 32], maxZoom: 17, animate: false });
        opts.onCluster(cluster.shops);
      })
      .addTo(layer);
  }

  return markers;
}

/** 基準地点の印と同心円。**地図は動かさない。** */
export function drawOrigin(layer: L.LayerGroup, origin: MapOrigin): void {
  for (const radius of RANGE_RINGS) {
    L.circle([origin.lat, origin.lon], { ...RING, radius }).addTo(layer);
  }
  L.circleMarker([origin.lat, origin.lon], {
    radius: 5,
    color: "#ffffff",
    weight: 2,
    fillColor: ORIGIN_COLOR,
    fillOpacity: 1,
  })
    .bindTooltip(textTooltip(origin.label ? `基準地点: ${origin.label}` : "基準地点"))
    .addTo(layer);
}

/**
 * 順路の線と番号。
 *
 * 番号は divIcon（ただの HTML）で描く。Leaflet の既定アイコンは PNG を
 * 外部参照するので、単一 HTML に固められない（CLAUDE.md の制約）。
 *
 * 戻り値は線が通る点。呼ぶ側がここへ寄せるのに使う。
 */
export function drawRoute(
  layer: L.LayerGroup,
  route: Shop[],
  origin?: { lat: number; lon: number },
): Array<[number, number]> {
  const points: Array<[number, number]> = route.map((s) => [s.lat, s.lon]);
  // 出発点が分かっているなら、そこから 1 軒目までも引く。
  const line = origin ? [[origin.lat, origin.lon] as [number, number], ...points] : points;
  if (line.length > 1) L.polyline(line, ROUTE_LINE).addTo(layer);

  route.forEach((shop, i) => {
    L.marker([shop.lat, shop.lon], {
      icon: L.divIcon({
        // 素のクラスは E2E が順路の番号だけを数えるため（塊と紛れる）。
        className: `${styles.routePin} route-pin`,
        html: String(i + 1),
        iconSize: [24, 24],
      }),
      pane: ROUTE_PANE,
      // 番号は順路を読むためのもの。押す先は店のピンに任せる。
      interactive: false,
      keyboard: false,
    }).addTo(layer);
  });

  return line;
}
