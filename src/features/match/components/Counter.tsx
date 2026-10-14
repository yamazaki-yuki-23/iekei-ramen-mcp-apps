import { useEffect, useRef } from "react";
import styles from "../styles/match.module.css";

/** 今日出会った知らない家系の数。カタカタと回って増える（transform だけ）。 */
export function Counter({ value, reduce }: { value: number; reduce: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  useEffect(() => {
    const el = ref.current?.firstElementChild as HTMLElement | null;
    if (!el || reduce || prev.current === value) {
      prev.current = value;
      return;
    }
    el.animate([{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], {
      duration: 180,
      easing: "cubic-bezier(.3,.7,.3,1.3)",
    });
    prev.current = value;
  }, [value, reduce]);
  return (
    <div className={styles.counter}>
      今日出会った知らない家系
      <span className={styles.odo} ref={ref}>
        <span>{value}</span>
      </span>
      軒
    </div>
  );
}
