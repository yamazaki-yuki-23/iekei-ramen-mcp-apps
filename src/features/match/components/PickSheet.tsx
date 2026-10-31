import { useState } from "react";
import { formatDistance } from "../../../utils/geo";
import { MAX_STOPS } from "../../../utils/route";
import type { Shop } from "../../../types";
import styles from "../styles/match.module.css";
import { Sheet } from "./Sheet";
import { shopName } from "../../../utils/shop-name";

export function PickSheet({
  shops,
  onPick,
  onBack,
  onClear,
}: {
  shops: Shop[];
  onPick(picked: Shop[]): void;
  onBack(): void;
  onClear(): void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((now) =>
      now.includes(id) ? now.filter((p) => p !== id) : [...now, id].slice(0, MAX_STOPS),
    );
  const chosen = new Set(picked);
  return (
    <Sheet title={`行きたい ${shops.length} 軒`}>
      <p>まわるなら {MAX_STOPS} 軒まで選んでください。選ばなかった店もリストに残ります。</p>
      <ul className={styles.list}>
        {shops.map((s) => {
          const on = chosen.has(s.id);
          return (
            <li key={s.id}>
              <input
                type="checkbox"
                id={`want-${s.id}`}
                checked={on}
                disabled={!on && picked.length >= MAX_STOPS}
                onChange={() => toggle(s.id)}
              />
              <span>
                <label htmlFor={`want-${s.id}`}>{shopName(s)}</label>
                <small>
                  {s.distanceKm !== undefined && `直線 ${formatDistance(s.distanceKm)}・`}
                  {s.city ?? s.prefecture}
                </small>
              </span>
            </li>
          );
        })}
      </ul>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.btnPrimary}
          disabled={picked.length === 0}
          onClick={() => onPick(shops.filter((s) => chosen.has(s.id)))}
        >
          選んだ店で順路にする
        </button>
        <button type="button" className={styles.btn} onClick={onBack}>
          食券に戻る
        </button>
        <button type="button" className={styles.btn} onClick={onClear}>
          リストを空にする
        </button>
      </div>
    </Sheet>
  );
}
