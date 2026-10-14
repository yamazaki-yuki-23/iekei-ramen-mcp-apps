import { useState } from "react";
import { exitFor } from "../utils/swipe";
import type { Origin, Shop } from "../../../types";
import styles from "../styles/match.module.css";
import { StatusSheet } from "./StatusSheet";
import { TodaySheet } from "./TodaySheet";
import { RouteSheet } from "./RouteSheet";
import { PickSheet } from "./PickSheet";

/** 「行きたい」の数で出口が変わる（1 軒 → 地図アプリ / 2〜3 軒 → まわる店 / 4 軒以上 → 3 軒まで選ぶ）。 */
export function WantsSheet({
  wants,
  origin,
  onBack,
  onClear,
}: {
  wants: Shop[];
  origin?: Origin;
  onBack(): void;
  onClear(): void;
}) {
  const [route, setRoute] = useState<Shop[] | null>(null);
  const sorted = wants.toSorted((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
  if (route) return <RouteSheet shops={route} origin={origin} onBack={onBack} />;
  switch (exitFor(sorted.length)) {
    case "none":
      return (
        <StatusSheet
          title="行きたいリストは空です"
          text="気になる店を右に払うと、ここにたまります。"
          action={
            <button type="button" className={styles.btn} onClick={onBack}>
              食券に戻る
            </button>
          }
        />
      );
    case "map":
      return <TodaySheet shop={sorted[0]} onBack={onBack} onClear={onClear} />;
    case "route":
      return <RouteSheet shops={sorted} origin={origin} onBack={onBack} onClear={onClear} />;
    default:
      return <PickSheet shops={sorted} onPick={setRoute} onBack={onBack} onClear={onClear} />;
  }
}
