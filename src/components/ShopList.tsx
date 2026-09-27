import { useMemo, type ReactNode } from "react";
import { sameNameLabels } from "../lib/same-name";
import { CONFIDENCE, TASTES, type Shop } from "../lib/types";
import { formatDistance } from "../lib/geo";
import styles from "../mcp-app.module.css";

interface Props {
  shops: Shop[];
  /** 順位番号を出す（近い順のとき）。 */
  ranked?: boolean;
  selectedId?: string;
  onSelect?: (shop: Shop) => void;
  /**
   * 選択中のカードの直下に差し込むもの。
   * 一覧の上に置くと、選んだ瞬間に一覧全体が下にずれて次のカードを押せない。
   */
  detail?: ReactNode;
  emptyMessage?: string;
  /**
   * 訪問済みの店舗 ID。
   *
   * **匿名なら渡ってこない（undefined）。** 空集合と区別する必要はここには無いが、
   * 渡す側が「サインインしていない」を空集合に化けさせないよう、省略可にしてある。
   */
  visitedIds?: ReadonlySet<string>;
}

export function ShopList({
  shops,
  ranked,
  selectedId,
  onSelect,
  detail,
  emptyMessage,
  visitedIds,
}: Props) {
  /*
   * 同名の店が並ぶときだけ、どこの店かを名前の隣に出す。
   * **一覧の中身から決める。** 渡す側に任せると、出し忘れた一覧だけ
   * 同じ名前が並ぶ（「迷ったら」も「行った店」も同じ部品を使っている）。
   */
  const labels = useMemo(() => sameNameLabels(shops), [shops]);
  if (shops.length === 0) {
    return (
      <p className={styles.empty}>{emptyMessage ?? "条件に合う店舗が見つかりませんでした。"}</p>
    );
  }

  return (
    <ul className={styles.list}>
      {shops.map((shop, i) => (
        <li key={shop.id} className={selectedId === shop.id ? styles.listItemSelected : undefined}>
          <button
            type="button"
            className={`${styles.card} ${selectedId === shop.id ? styles.cardSelected : ""}`}
            onClick={() => onSelect?.(shop)}
            aria-current={selectedId === shop.id || undefined}
          >
            {ranked && <span className={styles.rank}>{i + 1}</span>}
            <span className={styles.cardBody}>
              <span className={styles.shopHead}>
                {/* 取り出す対象を名指しできるようにしておく（テストが店名だけを読む）。 */}
                <span className={styles.shopName} data-shop-name>
                  {shop.name}
                </span>
                {labels.has(shop.id) && (
                  <span className={styles.shopWhere} data-shop-where>
                    {labels.get(shop.id)}
                  </span>
                )}
              </span>
              <span className={styles.meta}>
                {[shop.prefecture, shop.city, shop.address].filter(Boolean).join(" ")}
              </span>
              {shop.openingHours && <span className={styles.meta}>営業: {shop.openingHours}</span>}
              <span className={styles.badges}>
                {visitedIds?.has(shop.id) && <span className={styles.badgeVisited}>行った</span>}
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
          {selectedId === shop.id && detail}
        </li>
      ))}
    </ul>
  );
}
