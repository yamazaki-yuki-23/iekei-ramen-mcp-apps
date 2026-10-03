import { useEffect, type RefObject } from "react";
import type { drawShops } from "../components/map-layers";

/** 描き直しを含む各commitで訪問印を同期する。同じ描画・状態なら更新側が即座に戻る。 */
export function useVisitedMarkers(
  drawing: RefObject<ReturnType<typeof drawShops> | null>,
  visitedIds?: ReadonlySet<string>,
) {
  useEffect(() => {
    drawing.current?.updateVisited(visitedIds);
  });
}
