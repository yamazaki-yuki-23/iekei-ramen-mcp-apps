import { useEffect, useState } from "react";

/**
 * active が ms 以上続いたら true（#214）。それより早く終わる待ちでは、骨組みや薄い表示を出さない
 * （一瞬だけ出て消えるのが、ちらつきに見えるため）。
 */
export function useSlow(active: boolean, ms = 300): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setSlow(true), ms);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [active, ms]);
  return active && slow;
}
