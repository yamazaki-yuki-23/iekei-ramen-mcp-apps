import { formatDistance } from "../lib/geo";
import { CONFIDENCE, TASTES, type Shop } from "../lib/types";
import styles from "../mcp-app.module.css";
import { OrderGuide } from "./OrderGuide";

interface Props {
  shop: Shop;
  /** 会話に「この店について聞く」を流す。 */
  onAsk: () => void;
  /** 外部地図を開く。 */
  onOpenMap: () => void;
  onClear: () => void;
  asking: boolean;
}

/**
 * 選択中の店。UI の選択をモデルに渡す導線をここに集めている。
 *
 * 以前はカードを押すと即座に外部地図が開いていたが、それだと選択という状態が
 * 残らず、モデルに渡すものが無かった。カードは選ぶだけにして、その先の行き先を
 * このパネルに出す。
 */
export function SelectedShop({ shop, onAsk, onOpenMap, onClear, asking }: Props) {
  const where = [shop.prefecture, shop.city, shop.address].filter(Boolean).join(" ");

  return (
    <section className={styles.selected} aria-label="選択中の店舗">
      <div className={styles.selectedHead}>
        <div className={styles.cardBody}>
          <span className={styles.shopName}>{shop.name}</span>
          <span className={styles.meta}>{where}</span>
          {shop.openingHours && <span className={styles.meta}>営業: {shop.openingHours}</span>}
          <span className={styles.badges}>
            <span className={shop.taste === "unknown" ? styles.badgeMuted : styles.badge}>
              {TASTES[shop.taste].label}
            </span>
            {shop.confidence !== "confirmed" && (
              <span className={styles.badgeMuted} title={CONFIDENCE[shop.confidence].description}>
                {CONFIDENCE[shop.confidence].label}
              </span>
            )}
            {shop.brand && <span className={styles.badgeMuted}>{shop.brand}</span>}
          </span>
        </div>
        {shop.distanceKm !== undefined && (
          <span className={styles.distance}>{formatDistance(shop.distanceKm)}</span>
        )}
      </div>

      <div className={styles.selectedActions}>
        <button type="button" className={styles.button} onClick={onAsk} disabled={asking}>
          {asking ? "送信中…" : "この店について聞く"}
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={onOpenMap}>
          地図で開く
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={onClear}>
          選択を解除
        </button>
      </div>

      <OrderGuide />

      <p className={styles.selectedNote}>
        選んだ店の情報はチャットに渡してあります。「この店について聞く」を押すと、この店を
        話題にした質問がチャットに送られます。
      </p>
    </section>
  );
}
