/**
 * ロゴ。ラーメン丼を横から（#144）。茶赤の丼に黒い縁、海苔 1 枚（家系の記号）と箸 2 本。
 *
 * favicon（public/favicon.svg）と同じ絵。色はトークンから取るので、暗い表示では
 * 縁・海苔・箸が明るい色に変わり、ホストの背景に沈まない。
 * 単一 HTML に固めるため画像ファイルにせず、ここで描く。
 */
export function BrandMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <g stroke="var(--color-ink)" strokeWidth="4" strokeLinecap="round">
        <line x1="47" y1="5" x2="30" y2="29" />
        <line x1="55" y1="9" x2="36" y2="29" />
      </g>
      <rect x="13" y="12" width="11" height="19" rx="1.5" fill="var(--color-ink)" />
      <rect x="4" y="27" width="56" height="7" rx="3.5" fill="var(--color-ink)" />
      <path d="M7 33H57C57 48 46 57 32 57C18 57 7 48 7 33Z" fill="var(--color-accent-fill)" />
      <rect x="21" y="56" width="22" height="5" rx="2" fill="var(--color-accent-fill)" />
    </svg>
  );
}
