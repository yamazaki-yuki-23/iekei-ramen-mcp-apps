import { useEffect, useRef, useState } from "react";
import { BrandMark } from "../components/BrandMark";
import { DATA_CREDIT } from "../lib/data-caveats";
import type { Ask, SwipeDir } from "../lib/swipe";
import type { TasteKey } from "../lib/types";
import { isMuted, setMuted } from "./sound";
import styles from "./swipe.module.css";

export function Header({
  place,
  wants,
  onWants,
}: {
  place: string;
  wants: number;
  onWants(): void;
}) {
  const [muted, setMutedState] = useState(isMuted);
  return (
    <div className={styles.top}>
      <div>
        <a className={styles.brand} href="/">
          <BrandMark size={28} />
          家系スワイプ
        </a>
        {place && <div className={styles.place}>{place}</div>}
      </div>
      <div className={styles.headRight}>
        <button
          type="button"
          className={styles.round}
          aria-pressed={muted}
          aria-label={muted ? "音を出す" : "音を消す"}
          onClick={() => {
            setMuted(!muted);
            setMutedState(!muted);
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
            <path className={styles.wave} d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
            <path className={styles.slash} d="M16 9l6 6M22 9l-6 6" />
          </svg>
        </button>
        <button type="button" className={styles.round} onClick={onWants}>
          行きたい <b>{wants}</b>
        </button>
      </div>
    </div>
  );
}

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

const TASTE_CHIPS: Array<[TasteKey | "", string]> = [
  ["", "こだわらない"],
  ["rich", "直系・濃厚"],
  ["creamy", "クリーミー"],
  ["chain", "チェーン・万人向け"],
];

/** 画面からの問いかけ。持っている事実だけ（src/lib/swipe.ts）。 */
export function AskLine({
  ask,
  taste,
  onTaste,
  combo,
  reduce,
  tasteLocked,
}: {
  ask: Ask | null;
  taste: string;
  onTaste(t: TasteKey | ""): void;
  combo: number;
  reduce: boolean;
  /** 札が飛んでいる間は味を変えさせない。 */
  tasteLocked: boolean;
}) {
  return (
    <div className={styles.askWrap}>
      <p className={styles.ask} aria-live="polite">
        {ask?.text}
        {ask?.sub && <small>{ask.sub}</small>}
      </p>
      {ask?.offerTaste && (
        <div className={styles.chips} role="group" aria-label="味の傾向（参考）">
          {TASTE_CHIPS.map(([key, label]) => (
            <button
              key={label}
              type="button"
              className={styles.chip}
              aria-pressed={taste === key}
              disabled={tasteLocked}
              onClick={() => onTaste(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <Combo value={combo} reduce={reduce} />
    </div>
  );
}

/** 行きたいが続くと「2 連」「3 連」。数字が大きくなり、パスで途切れる。 */
function Combo({ value, reduce }: { value: number; reduce: boolean }) {
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

/** 操作キー（払えない人も同じことができる）と、但し書き・出典。 */
export function Controls({
  canSwipe,
  canUndo,
  onFly,
  onUndo,
  onToday,
}: {
  canSwipe: boolean;
  canUndo: boolean;
  onFly(dir: SwipeDir): void;
  onUndo(): void;
  onToday(): void;
}) {
  return (
    <>
      <div className={styles.keys}>
        <button
          type="button"
          className={styles.key}
          onClick={() => onFly("pass")}
          disabled={!canSwipe}
        >
          ← パス<small>左に払う</small>
        </button>
        <button type="button" className={styles.key} onClick={onUndo} disabled={!canUndo}>
          戻す<small>1 枚</small>
        </button>
        <button
          type="button"
          className={styles.keyWant}
          onClick={() => onFly("want")}
          disabled={!canSwipe}
        >
          行きたい →<small>右に払う</small>
        </button>
      </div>
      <button type="button" className={styles.today} onClick={onToday} disabled={!canSwipe}>
        今日はここ（Enter）
      </button>
      <p className={styles.caveat}>
        家系かどうかは推定、味の傾向は参考値で、並び順は近い順（おすすめ度ではありません）。距離は直線距離です。違う店があれば、
        <a href="/">トップ</a>で店を開き「店舗情報を報告する」から教えてください。
      </p>
      <p className={styles.credit}>{DATA_CREDIT}</p>
    </>
  );
}
