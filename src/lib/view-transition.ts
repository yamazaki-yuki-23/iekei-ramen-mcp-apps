import { flushSync } from "react-dom";

/*
 * 画面の中の切り替え（店の詳細）を、ブラウザの View Transitions で短く動かす（#212）。
 * ページをまたぐ移動は CSS の @view-transition（global.css）が受け持つ。
 *
 * **動かさないとき:** 対応していないブラウザ、動きを減らす設定。どちらも今までどおり、その場で切り替える。
 */
export function withViewTransition(update: () => void, prepare?: () => () => void) {
  if (
    typeof document.startViewTransition !== "function" ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    update();
    return;
  }
  const cleanup = prepare?.();
  // 撮る直前と直後の画面の間で、React の描き直しを同期で済ませる（済まないと、動かずに切り替わる）。
  const transition = document.startViewTransition(() => flushSync(update));
  void transition.finished.finally(() => cleanup?.());
}

/**
 * 画面に見えている店のカードに、動かすための名前を一時的に付ける（店の詳細を開く・閉じる）。
 * 詳細が開くと下のカードが押し下げられるので、名前で前後の位置を結び、滑らせる。
 * 見えていないカードまで名前を付けると、一覧（最大 200 枚）を全部撮ることになるので付けない。
 */
export function nameVisibleCards(): () => void {
  const named: HTMLElement[] = [];
  for (const card of document.querySelectorAll<HTMLElement>("button[data-shop-id]")) {
    const box = card.getBoundingClientRect();
    if (box.bottom < 0 || box.top > innerHeight) continue;
    card.style.viewTransitionName = `shop-${named.length}`;
    named.push(card);
  }
  return () => {
    for (const card of named) card.style.viewTransitionName = "";
  };
}
