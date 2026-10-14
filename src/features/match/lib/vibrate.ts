/** 対応端末だけ短く振動させる。 */
export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // 振動できない端末では何もしない。
  }
}
