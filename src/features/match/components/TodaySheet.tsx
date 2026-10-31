import { formatDistance } from "../../../utils/geo";
import type { Shop } from "../../../types";
import styles from "../styles/match.module.css";
import { mapUrl } from "../utils/map-url";
import { Share } from "./Share";
import { Sheet } from "./Sheet";
import { shopName } from "../../../utils/shop-name";

/** onClear は「行きたい」リストから開いたときだけ渡す（何軒でも空にできるように、#180）。 */
export function TodaySheet({
  shop,
  onBack,
  onClear,
}: {
  shop: Shop;
  onBack(): void;
  onClear?(): void;
}) {
  return (
    <Sheet title={`今日は「${shopName(shop)}」`}>
      <p>
        {shop.distanceKm !== undefined && `直線 ${formatDistance(shop.distanceKm)}。`}
        初めてなら、麺の硬さも味の濃さも油の量も「普通」で頼むのが定番です。
      </p>
      <div className={styles.row}>
        <a
          className={styles.btnPrimary}
          href={mapUrl(shop)}
          target="_blank"
          rel="noopener noreferrer"
        >
          地図アプリで開く
        </a>
        <button type="button" className={styles.btn} onClick={onBack}>
          続けて見る
        </button>
        {onClear && (
          <button type="button" className={styles.btn} onClick={onClear}>
            リストを空にする
          </button>
        )}
      </div>
      <Share names={[shopName(shop)]} />
    </Sheet>
  );
}
