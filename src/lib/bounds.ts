import type { Bounds } from "./types";

/** 世界全体。折り返しても箱で表せないときの逃げ先。 */
const WHOLE_WORLD = { east: 180, west: -180 } as const;

const clampLat = (v: number) => Math.max(-90, Math.min(90, v));

/**
 * 経度を -180〜180 に折り返す。
 *
 * **範囲内の値には触らない。** 無条件に剰余を取ると、折り返す必要のない
 * 139.68 が 139.68000000000006 になる。実害の無い桁ではあるが、payload は
 * モデルにも渡るので、動かす理由の無い値は動かさない。
 */
const wrapLon = (v: number) =>
  v >= -180 && v <= 180 ? v : ((((v + 180) % 360) + 360) % 360) - 180;

/**
 * 地図から受け取った生の範囲を、サーバーへ渡せる形に直す。
 *
 * 緯度は ±90 に丸めるだけでよい。**経度は丸めてはいけない。** 地図は世界を
 * 横に繰り返して描くので、隣の複製まで動かすと経度が 480〜510 のようになる。
 * 両端を 180 に丸めると、日本が画面に出ているのに幅ゼロの範囲になり、
 * 「この範囲で探す」が 0 件を返す（実測）。
 *
 * **迷ったら広く返す。** 1 周以上が入っているときと、折り返した結果が日付
 * 変更線をまたぐときは世界全体にする。見えている店を「無い」と答えるより、
 * 広く返すほうが嘘が少ない。
 */
export function normalizeBounds(raw: {
  north: number;
  south: number;
  east: number;
  west: number;
}): Bounds {
  const north = clampLat(raw.north);
  const south = clampLat(raw.south);
  if (raw.east - raw.west >= 360) return { north, south, ...WHOLE_WORLD };

  const west = wrapLon(raw.west);
  const east = wrapLon(raw.east);
  if (west > east) return { north, south, ...WHOLE_WORLD };
  return { north, south, east, west };
}
