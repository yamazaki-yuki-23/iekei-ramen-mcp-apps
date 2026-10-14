import type { CSSProperties } from "react";

/**
 * ホストが指定する画面端の余白（ノッチや角丸を避けるための寸法）を CSS 変数にする。
 *
 * **padding を直接書かないこと。** インラインの padding は CSS の
 * `.main { padding: var(--space-4) }` より強いので、セーフエリアが 0 の
 * ホストでは余白がまるごと消える（ChatGPT は desktop でも 4 辺 0 を送ってくる。
 * Claude は safeAreaInsets ごと送ってこないので、React が属性を省いて
 * CSS が生き残っていた——ホスト差ではなく、こちらの上書きが原因）。
 *
 * セーフエリアは「避けるべき寸法」であってアプリの余白の代わりではないので、
 * 変数で渡して CSS 側で足す。値が無いホストでは変数を置かず、
 * CSS のフォールバック（0px）に任せる。
 */
export function safeAreaStyle(inset?: {
  top: number;
  right: number;
  bottom: number;
  left: number;
}): CSSProperties {
  if (!inset) return {};
  return {
    "--safe-area-top": `${inset.top}px`,
    "--safe-area-right": `${inset.right}px`,
    "--safe-area-bottom": `${inset.bottom}px`,
    "--safe-area-left": `${inset.left}px`,
  } as CSSProperties;
}
