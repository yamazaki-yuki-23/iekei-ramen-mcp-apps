import type { CircleMarker } from "leaflet";
import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * キーボードで選んだピンへ焦点を戻す。
 *
 * **選ぶと印を描き直すので、押していた要素ごと消える。** ブラウザは焦点を
 * 引き継がないので body へ落ち、次の Tab が画面の先頭から始まる
 * （実測: Enter のあと activeElement が BODY になっていた）。
 *
 * 戻す機会は 1 回では足りない。選ぶと地図がその店へ寄ってズームが変わり、
 * 塊を組み直すので、**描き直しは続けて何度か起きる**。印を持っているあいだは
 * そのたびに戻し、焦点が他所へ移ったら印を落とす（拡大縮小の釦へ移ったあとに
 * 引き戻さないため）。
 */
export function useMarkerFocus(markers: RefObject<Map<string, CircleMarker>>) {
  const wanted = useRef<string | null>(null);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const intended = wanted.current ? markers.current.get(wanted.current)?.getElement() : null;
      // 要素が消えて body へ落ちるときは focusin が出ないので、戻す機会は残る。
      if (e.target !== intended) wanted.current = null;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [markers]);

  /** キーボードで選ばれたことを覚える。 */
  const remember = useCallback((shopId: string) => {
    wanted.current = shopId;
  }, []);

  /** 描き直したあとに呼ぶ。覚えている店と一致するときだけ戻す。 */
  const restore = useCallback(
    (selectedId?: string) => {
      if (!selectedId || wanted.current !== selectedId) return;
      // circleMarker の実体は SVG の path。focus は HTMLElement 側の型にしか無い。
      (markers.current.get(selectedId)?.getElement() as SVGElement | null)?.focus();
    },
    [markers],
  );

  return { remember, restore };
}
