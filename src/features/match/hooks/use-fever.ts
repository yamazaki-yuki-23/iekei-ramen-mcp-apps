import { useCallback, useEffect, useRef, useState } from "react";
import { FEVER_MS } from "../utils/swipe";
import type { Fx } from "../lib/fx";
import { sound } from "../../../lib/sound";
import { vibrate } from "../lib/vibrate";

/** FEVER: ゲージが満タンで FEVER_MS。払う手数へのご褒美（店の良し悪しは表さない）。 */
export function useFever(fx: React.RefObject<Fx | null>, reduce: boolean) {
  const [gauge, setGauge] = useState(0);
  const [fever, setFever] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const charge = useCallback(
    (n: number) => {
      if (fever || reduce) return;
      const next = Math.min(100, gauge + n);
      setGauge(next);
      if (next < 100) return;
      setFever(true);
      fx.current?.startFever();
      sound.fever();
      vibrate([60, 40, 60]);
      timer.current = window.setTimeout(() => {
        void fx.current?.endFever().then(() => {
          setFever(false);
          setGauge(0);
        });
      }, FEVER_MS);
    },
    [fever, gauge, fx, reduce],
  );
  return { gauge, fever, charge };
}
