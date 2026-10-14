import type { Ask } from "../utils/swipe";
import type { TasteKey } from "../../../types";
import styles from "../styles/match.module.css";
import { Combo } from "./Combo";

const TASTE_CHIPS: Array<[TasteKey | "", string]> = [
  ["", "こだわらない"],
  ["rich", "直系・濃厚"],
  ["creamy", "クリーミー"],
  ["chain", "チェーン・万人向け"],
];

/** 画面からの問いかけ。持っている事実だけ（src/features/match/utils/swipe.ts）。 */
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
