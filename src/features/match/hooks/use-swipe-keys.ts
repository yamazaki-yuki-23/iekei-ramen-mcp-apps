import { useEffect, useRef } from "react";
import { unlock } from "../../../lib/sound";

/**
 * キーボード: ← パス、→ 行きたい、Enter 今日はここ、Backspace 戻す。
 * Backspace は札が無いとき（全部見た・今日はここ の紙）でも戻せるようにし、ブラウザの「戻る」にさせない。
 */
export function useSwipeKeys(keys: {
  canUndo: boolean;
  canAct: boolean;
  onUndo: () => void;
  onFly: (dir: "want" | "pass") => void;
  onToday: () => void;
}) {
  const latest = useRef(keys);
  useEffect(() => {
    latest.current = keys;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      unlock();
      const k = latest.current;
      const target = e.target as HTMLElement;
      if (e.key === "Backspace") {
        if (target.closest("input, select, textarea") || !k.canUndo) return;
        e.preventDefault();
        k.onUndo();
        return;
      }
      const arrow = e.key === "ArrowLeft" || e.key === "ArrowRight";
      if ((!arrow && target.closest("input, a, button, select, textarea")) || !k.canAct) return;
      if (arrow) {
        e.preventDefault();
        k.onFly(e.key === "ArrowRight" ? "want" : "pass");
      } else if (e.key === "Enter") {
        e.preventDefault();
        k.onToday();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
