/**
 * ロゴ。地図のピンの頭が、上から見た丼になっている。
 *
 * ピンは約束の「近くに」、海苔 3 枚は「迷ったら 3 軒」（#123）。
 * 色はトークンから取るので、パレットを変えればロゴも付いてくる。
 * 単一 HTML に固めるため画像ファイルにせず、ここで描く。
 */
export function BrandMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        d="M24 46C24 46 6 30 6 19a18 18 0 0 1 36 0c0 11-18 27-18 27z"
        fill="var(--color-accent-fill)"
        stroke="var(--color-on-sign)"
        strokeWidth="2.5"
      />
      <circle
        cx="24"
        cy="19"
        r="11"
        fill="var(--color-sign)"
        stroke="var(--color-on-sign)"
        strokeWidth="2"
      />
      <g fill="var(--color-on-sign)">
        <rect x="13.5" y="6" width="5" height="12" rx="1" transform="rotate(-12 16 12)" />
        <rect x="19.5" y="4.5" width="5" height="12" rx="1" />
        <rect x="25.5" y="6" width="5" height="12" rx="1" transform="rotate(12 28 12)" />
      </g>
      <circle cx="27" cy="23" r="2" fill="var(--color-on-stage)" />
      <circle cx="21" cy="25" r="1.4" fill="var(--color-on-stage)" />
    </svg>
  );
}
