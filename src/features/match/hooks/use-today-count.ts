import { useCallback, useEffect, useState } from "react";
import { addMet, loadMet } from "../lib/storage";

/** 今日出会った数。開いたまま 0 時を越えたら読み直す（次の 0 時と、画面に戻ってきたとき）。 */
export function useTodayCount() {
  const [met, setMet] = useState(loadMet);
  useEffect(() => {
    let timer = 0;
    const refresh = () => setMet(loadMet());
    const schedule = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = window.setTimeout(
        () => {
          refresh();
          schedule();
        },
        next.getTime() - now.getTime() + 1000,
      );
    };
    schedule();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const add = useCallback((delta: number) => setMet(addMet(delta)), []);
  return { met, add };
}
