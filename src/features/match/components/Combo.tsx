import { useEffect, useRef } from "react";
import styles from "../styles/match.module.css";

/** 行きたいが続くと「2 連」「3 連」。数字が大きくなり、パスで途切れる。 */
export function Combo({ value, reduce }: { value: number; reduce: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || reduce || value < 2) return;
    ref.current.animate(
      [
        { transform: "scale(1.8) rotate(-6deg)", opacity: 0.2 },
        { transform: "scale(0.94) rotate(-4deg)", opacity: 1, offset: 0.6 },
        { transform: "scale(1) rotate(-4deg)", opacity: 1 },
      ],
      { duration: 320, easing: "cubic-bezier(.2,.9,.3,1)" },
    );
  }, [value, reduce]);
  return (
    <div
      ref={ref}
      className={styles.combo}
      aria-live="polite"
      style={{ opacity: value >= 2 ? 1 : 0, fontSize: `${22 + Math.min(value, 8) * 5}px` }}
    >
      {value >= 2 ? `${value} 連` : ""}
    </div>
  );
}
