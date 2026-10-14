import { describeLeg, googleMapsRouteUrl, planRoute } from "../../../utils/route";
import type { Origin, Shop } from "../../../types";
import styles from "../styles/match.module.css";
import { mapUrl } from "../utils/map-url";
import { Share } from "./Share";
import { Sheet } from "./Sheet";

export function RouteSheet({
  shops,
  origin,
  onBack,
  onClear,
}: {
  shops: Shop[];
  origin?: Origin;
  onBack(): void;
  onClear?(): void;
}) {
  const route = planRoute(shops, origin);
  return (
    <Sheet title={`まわる店（${route.legs.length} 軒）`}>
      <p>順番は、合計の直線距離が短くなる並びです。線は直線で、道のりではありません。</p>
      <ol className={styles.list}>
        {route.legs.map((leg, i) => (
          <li key={leg.shop.id}>
            <strong>{i + 1}</strong>
            <span>
              {leg.shop.name}
              <small>{describeLeg(leg, i, origin)}</small>
            </span>
            <a
              className={styles.btn}
              href={mapUrl(leg.shop)}
              target="_blank"
              rel="noopener noreferrer"
            >
              地図
            </a>
          </li>
        ))}
      </ol>
      <div className={styles.row}>
        <a
          className={styles.btnPrimary}
          href={googleMapsRouteUrl(route, origin)}
          target="_blank"
          rel="noopener noreferrer"
        >
          順路を地図アプリで開く
        </a>
        <button type="button" className={styles.btn} onClick={onBack}>
          食券に戻る
        </button>
        {onClear && (
          <button type="button" className={styles.btn} onClick={onClear}>
            リストを空にする
          </button>
        )}
      </div>
      <Share names={route.legs.map((leg) => leg.shop.name)} />
    </Sheet>
  );
}
