import { CONFIDENCE, TASTES, type Shop } from "../lib/types";
import { formatDistance } from "../lib/geo";
import styles from "../mcp-app.module.css";

interface Props {
  shops: Shop[];
  /** 順位番号を出す（近い順のとき）。 */
  ranked?: boolean;
  selectedId?: string;
  onSelect?: (shop: Shop) => void;
  emptyMessage?: string;
}

export function ShopList({ shops, ranked, selectedId, onSelect, emptyMessage }: Props) {
  if (shops.length === 0) {
    return (
      <p className={styles.empty}>{emptyMessage ?? "条件に合う店舗が見つかりませんでした。"}</p>
    );
  }

  return (
    <ul className={styles.list}>
      {shops.map((shop, i) => (
        <li key={shop.id}>
          <button
            type="button"
            className={`${styles.card} ${selectedId === shop.id ? styles.cardSelected : ""}`}
            onClick={() => onSelect?.(shop)}
            aria-current={selectedId === shop.id || undefined}
          >
            {ranked && <span className={styles.rank}>{i + 1}</span>}
            <span className={styles.cardBody}>
              <span className={styles.shopName}>{shop.name}</span>
              <span className={styles.meta}>
                {[shop.prefecture, shop.city, shop.address].filter(Boolean).join(" ")}
              </span>
              {shop.openingHours && <span className={styles.meta}>営業: {shop.openingHours}</span>}
              <span className={styles.badges}>
                <span className={shop.taste === "unknown" ? styles.badgeMuted : styles.badge}>
                  {TASTES[shop.taste].label}
                </span>
                {shop.confidence !== "confirmed" && (
                  <span
                    className={styles.badgeMuted}
                    title={CONFIDENCE[shop.confidence].description}
                  >
                    {CONFIDENCE[shop.confidence].label}
                  </span>
                )}
                {shop.brand && <span className={styles.badgeMuted}>{shop.brand}</span>}
              </span>
            </span>
            {shop.distanceKm !== undefined && (
              <span className={styles.distance}>{formatDistance(shop.distanceKm)}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
