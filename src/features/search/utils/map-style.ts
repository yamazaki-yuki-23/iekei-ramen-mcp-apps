import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";

/**
 * 地図の背景のスタイル（#246、デザイナーの 4 回目の案）。
 *
 * **地図のデータは Protomaps の basemap**（OSM 由来）を、日本の範囲だけ切り出した PMTiles 1 ファイル。
 * 作り直し方は docs/development/map.md。色は地図の背景だけに使う（UI の部品には使わない）。
 *
 * 文字の量はズームで出し分ける: 〜7 地・海・森・県 → 7〜12.5 市・高速 → 9〜 主な道 → 10〜 線路・公園
 * → 11.5〜 駅 → 13〜 細い道 → 13.5〜 水の名前 → 14〜 町名・道路名 → 15〜 建物。
 * 交番・郵便局・コンビニなどの記号、番地、地下鉄の線、地図の中の店の名前は出さない。
 */
const MAP_COLORS = {
  land: "#f7f2e8",
  building: "#ece5d8",
  green: "#d3e8bd",
  wood: "#dcebc8",
  water: "#b7dcf0",
  waterText: "#3f7aa0",
  road: "#ffffff",
  roadCase: "#e3d8c6",
  major: "#ffffff",
  majorCase: "#d6c4a9",
  motor: "#f3c5b6",
  motorCase: "#e89d87",
  rail: "#b3aa9d",
  boundary: "#cdbfa8",
  place: "#5b544c",
  placeMinor: "#8a8278",
  station: "#4a4640",
  halo: "#ffffff",
} as const;

/** 文字の書体。漢字・かなは端末の丸ゴシックで描く（localIdeographFontFamily）。英数字だけをここから取る。 */
const FONT_REGULAR = ["Noto Sans Regular"];
export const FONT_MEDIUM = ["Noto Sans Medium"];
export const LOCAL_FONTS =
  "'Hiragino Maru Gothic ProN', 'M PLUS Rounded 1c', 'Hiragino Sans', 'Noto Sans JP', sans-serif";

const M = MAP_COLORS;
const name: ExpressionSpecification = ["coalesce", ["get", "name:ja"], ["get", "name"]];
const width = (a: number, b: number): ExpressionSpecification => [
  "interpolate",
  ["exponential", 1.6],
  ["zoom"],
  8,
  a,
  17,
  b,
];
const round = { "line-cap": "round", "line-join": "round" } as const;
const kind = (...k: string[]): ExpressionSpecification => ["in", ["get", "kind"], ["literal", k]];
const detail = (...k: string[]): ExpressionSpecification => [
  "in",
  ["get", "kind_detail"],
  ["literal", k],
];
const halo = { "text-color": M.place, "text-halo-color": M.halo, "text-halo-width": 2 };
const src = { source: "basemap" } as const;

function layers(): LayerSpecification[] {
  return [
    { id: "bg", type: "background", paint: { "background-color": M.land } },
    {
      id: "earth",
      type: "fill",
      ...src,
      "source-layer": "earth",
      paint: { "fill-color": M.land },
    },
    {
      id: "landcover",
      type: "fill",
      ...src,
      "source-layer": "landcover",
      filter: kind("forest", "grassland", "scrub"),
      paint: {
        "fill-color": M.wood,
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4, 1, 9, 0.6],
      },
    },
    {
      id: "wood",
      type: "fill",
      ...src,
      "source-layer": "landuse",
      filter: kind("forest", "wood", "nature_reserve", "national_park"),
      paint: { "fill-color": M.wood },
    },
    {
      id: "park",
      type: "fill",
      ...src,
      "source-layer": "landuse",
      minzoom: 10,
      filter: kind("park", "grass", "garden", "recreation_ground", "pitch", "cemetery"),
      paint: { "fill-color": M.green },
    },
    {
      id: "water",
      type: "fill",
      ...src,
      "source-layer": "water",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": M.water },
    },
    {
      id: "river",
      type: "line",
      ...src,
      "source-layer": "water",
      minzoom: 10,
      filter: ["==", ["geometry-type"], "LineString"],
      layout: round,
      paint: { "line-color": M.water, "line-width": width(0.8, 5) },
    },
    {
      id: "building",
      type: "fill",
      ...src,
      "source-layer": "buildings",
      minzoom: 15,
      paint: { "fill-color": M.building },
    },
    {
      id: "boundary",
      type: "line",
      ...src,
      "source-layer": "boundaries",
      maxzoom: 11,
      filter: kind("region"),
      layout: round,
      paint: { "line-color": M.boundary, "line-width": 1.2, "line-dasharray": [2, 2] },
    },
    {
      id: "minor-case",
      type: "line",
      ...src,
      "source-layer": "roads",
      minzoom: 13,
      filter: kind("minor_road"),
      layout: round,
      paint: { "line-color": M.roadCase, "line-width": width(1.2, 11) },
    },
    {
      id: "minor",
      type: "line",
      ...src,
      "source-layer": "roads",
      minzoom: 13,
      filter: kind("minor_road"),
      layout: round,
      paint: { "line-color": M.road, "line-width": width(0.6, 9) },
    },
    {
      id: "major-case",
      type: "line",
      ...src,
      "source-layer": "roads",
      minzoom: 9,
      filter: kind("major_road"),
      layout: round,
      paint: { "line-color": M.majorCase, "line-width": width(1.8, 18) },
    },
    {
      id: "major",
      type: "line",
      ...src,
      "source-layer": "roads",
      minzoom: 9,
      filter: kind("major_road"),
      layout: round,
      paint: { "line-color": M.major, "line-width": width(1.1, 15) },
    },
    {
      id: "motor-case",
      type: "line",
      ...src,
      "source-layer": "roads",
      minzoom: 6,
      filter: ["all", kind("highway"), ["!", detail("motorway_link")]],
      layout: round,
      paint: { "line-color": M.motorCase, "line-width": width(1.6, 19) },
    },
    {
      id: "motor",
      type: "line",
      ...src,
      "source-layer": "roads",
      minzoom: 6,
      filter: ["all", kind("highway"), ["!", detail("motorway_link")]],
      layout: round,
      paint: { "line-color": M.motor, "line-width": width(0.9, 15) },
    },
    // 線路: 地上の普通鉄道だけ。地下の線・側線・車庫は出さない。白い破線はズーム 14 から。
    {
      id: "rail",
      type: "line",
      ...src,
      "source-layer": "roads",
      minzoom: 10,
      filter: ["all", kind("rail"), detail("rail"), ["!", ["has", "is_tunnel"]]],
      paint: { "line-color": M.rail, "line-width": width(0.8, 2.2) },
    },
    {
      id: "rail-dash",
      type: "line",
      ...src,
      "source-layer": "roads",
      minzoom: 14,
      filter: ["all", kind("rail"), detail("rail"), ["!", ["has", "is_tunnel"]]],
      paint: { "line-color": "#ffffff", "line-width": width(0.4, 1.1), "line-dasharray": [3, 3] },
    },
    {
      id: "road-name",
      type: "symbol",
      ...src,
      "source-layer": "roads",
      minzoom: 14,
      filter: ["all", kind("major_road"), detail("primary", "trunk", "secondary")],
      layout: {
        "symbol-placement": "line",
        "text-field": name,
        "text-font": FONT_REGULAR,
        "text-size": 12,
      },
      paint: halo,
    },
    {
      id: "water-name",
      type: "symbol",
      ...src,
      "source-layer": "water",
      minzoom: 13.5,
      filter: ["has", "name"],
      layout: { "text-field": name, "text-font": FONT_REGULAR, "text-size": 12 },
      paint: { "text-color": M.waterText, "text-halo-color": M.water, "text-halo-width": 1 },
    },
    {
      id: "pref",
      type: "symbol",
      ...src,
      "source-layer": "places",
      minzoom: 5,
      maxzoom: 7,
      filter: kind("region"),
      layout: { "text-field": name, "text-font": FONT_MEDIUM, "text-size": 12 },
      paint: halo,
    },
    {
      id: "city",
      type: "symbol",
      ...src,
      "source-layer": "places",
      minzoom: 7,
      maxzoom: 12.5,
      filter: ["all", kind("locality"), detail("city")],
      layout: {
        "text-field": name,
        "text-font": FONT_MEDIUM,
        "text-size": ["interpolate", ["linear"], ["zoom"], 7, 12, 11, 15],
      },
      paint: halo,
    },
    {
      id: "ward",
      type: "symbol",
      ...src,
      "source-layer": "places",
      minzoom: 10,
      maxzoom: 14,
      filter: ["all", kind("neighbourhood"), detail("suburb")],
      layout: { "text-field": name, "text-font": FONT_MEDIUM, "text-size": 14 },
      paint: halo,
    },
    {
      id: "town",
      type: "symbol",
      ...src,
      "source-layer": "places",
      minzoom: 14.5,
      filter: ["all", kind("neighbourhood"), detail("neighbourhood")],
      layout: { "text-field": name, "text-font": FONT_REGULAR, "text-size": 12 },
      paint: { ...halo, "text-color": M.placeMinor },
    },
  ];
}

/** 出典。地図の右下に、最初から畳んだ「i」で出す。 */
export const MAP_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a> | <a href="https://protomaps.com">Protomaps</a>';

/**
 * 背景のスタイル。`base` は地図データと文字の置き場所（末尾は `/`）。
 * Web 版は同じ場所の `/map/`、会話の中（MCP）は `https://iekeiramen.com/map/`。
 */
export function mapStyle(base: string): StyleSpecification {
  return {
    version: 8,
    glyphs: `${base}fonts/{fontstack}/{range}.pbf`,
    sources: {
      basemap: {
        type: "vector",
        url: `pmtiles://${base}japan.pmtiles`,
      },
    },
    layers: layers(),
  };
}
