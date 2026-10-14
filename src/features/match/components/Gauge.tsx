import styles from "../styles/match.module.css";

export function Gauge({ value, fever }: { value: number; fever: boolean }) {
  return (
    <div className={styles.gaugeRow}>
      <span className={styles.gaugeLabel}>{fever ? "FEVER" : "FEVER まで"}</span>
      <div
        className={styles.gauge}
        role="progressbar"
        aria-label="FEVER のゲージ"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fever ? 100 : value}
      >
        <i
          className={styles.gaugeBar}
          // FEVER の残り時間は、ゲージが 10 秒かけて減る形で見せる。
          style={{
            transform: `scaleX(${fever ? 0 : value / 100})`,
            transition: fever ? "transform 10s linear" : undefined,
          }}
        />
      </div>
    </div>
  );
}
