import { lazy } from "react";

/*
 * **地図（Leaflet）は後から読む**（#154）。Web の最初の画面は「迷ったら」か「店名で」で
 * 地図を使わないのに、Leaflet の JS と CSS が最初の JS の約 3 割を占めていた。
 * 結果を出した後、ブラウザが空いたときに先に読んでおく（preloadMapView）。結果より先に
 * 読み始めると、結果を取りに行く通信と帯域を取り合って、結果が出るのが遅れた。
 * 会話の中（MCP）は 1 ファイルに固めるので、ここで分けても読み込みは増えない。
 *
 * 読めなかったときは MapLoadBoundary が地図の場所で知らせる。ブラウザは読めなかった
 * モジュールを覚えていて、同じページでは import し直しても失敗するので、戻す手段は
 * ページの再読み込みになる（実測: 止めを外して読み直しても地図は出なかった）。
 */
const loadMapView = () => import("./MapView");
export const MapView = lazy(() => loadMapView().then((m) => ({ default: m.MapView })));

export function preloadMapView() {
  const whenIdle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1));
  // 先読みの失敗は、ここでは知らせない（未処理の拒否にしない）。地図を開いたときに画面で知らせる。
  whenIdle(() => void loadMapView().catch(() => {}));
}
