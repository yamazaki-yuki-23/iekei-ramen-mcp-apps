import type { CSSProperties, Ref } from "react";
import { formatDistance } from "../lib/geo";
import { openingHoursLabel } from "../lib/opening-hours";
import { TASTES, type Shop } from "../lib/types";
import styles from "./swipe.module.css";

interface Props {
  shop: Shop;
  /** めくった順の番号（1 始まり）。半券に出す。 */
  number: number;
  /** 裏向きで待っている札か。 */
  down: boolean;
  /** 上の札だけが読み上げの対象。下の札は裏向きなので隠す。 */
  hidden: boolean;
  style?: CSSProperties;
  ref?: Ref<HTMLElement>;
}

/**
 * 1 枚の食券。表（店の事実）と裏（地紋）の 2 面で、めくるまで中身が分からない。
 * 距離は半券に大きく出さず、本文の事実の 1 つとして小さく書く（オーナー判断）。
 * レア札は理由を事実で書く（直系・濃厚／朝 5 時から／その市区町村で 1 軒だけのブランド）。
 */
export function TicketCard({ shop, number, down, hidden, style, ref }: Props) {
  const facts = [
    shop.distanceKm !== undefined && `直線 ${formatDistance(shop.distanceKm)}`,
    shop.taste !== "unknown" && `味: ${TASTES[shop.taste].label}（参考）`,
    shop.brand,
  ].filter((f): f is string => Boolean(f));
  const rare = shop.facts ?? [];
  return (
    <article
      ref={ref}
      className={`${styles.ticket} ${down ? styles.down : ""}`}
      style={style}
      aria-hidden={hidden || undefined}
      aria-label={hidden ? undefined : `${number}枚目、${shop.name}`}
      data-shop-id={shop.id}
      data-rare={rare.length > 0 || undefined}
    >
      <div className={styles.flip}>
        <div className={`${styles.face} ${styles.front}`}>
          <div className={styles.stub} aria-hidden="true">
            <span>食券</span>
            <strong>{number}</strong>
            <span>枚目</span>
          </div>
          <div className={styles.body}>
            <span className={styles.order}>近い順</span>
            {rare.length > 0 && <span className={styles.rareTag}>◆ {rare.join("・")}</span>}
            <h2 className={styles.name}>{shop.name}</h2>
            <span className={styles.where}>
              {[shop.prefecture, shop.city, shop.address].filter(Boolean).join(" ")}
            </span>
            <div className={styles.facts}>
              {facts.map((f) => (
                <span className={styles.fact} key={f}>
                  {f}
                </span>
              ))}
            </div>
            <span className={styles.hours}>
              {shop.openingHours
                ? `営業 ${openingHoursLabel(shop.openingHours)}（地図の記載）`
                : "営業時間の記載なし"}
            </span>
          </div>
          <div className={styles.shine} />
        </div>
        <div className={`${styles.face} ${styles.back}`} aria-hidden="true">
          <span>食券</span>
        </div>
      </div>
      {rare.length > 0 && <div className={styles.gold} />}
      <span className={styles.stampWant} data-stamp="want" aria-hidden="true">
        行きたい
      </span>
      <span className={styles.stampPass} data-stamp="pass" aria-hidden="true">
        パス
      </span>
    </article>
  );
}
