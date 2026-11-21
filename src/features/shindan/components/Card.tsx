import { createElement } from "react";
import { rarity } from "../../../utils/shindan";
import { editionOf, type AnyType } from "../../../utils/shindan-editions";
import { faceShapes } from "../../../utils/shindan-face";
import styles from "../styles/shindan.module.css";

const camel = (k: string) => k.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

/** 丼のキャラクター（タイプごとに表情が変わる）。飾りなので読み上げない。 */
function Face({ type, size }: { type: AnyType; size: number }) {
  return (
    <svg viewBox="0 0 120 100" width={size} height={(size * 100) / 120} aria-hidden="true">
      {faceShapes(type.key).map((s, i) =>
        createElement(s.tag, {
          // 形の並びは固定（データの順）なので、番号で足りる。
          // oxlint-disable-next-line no-array-index-key
          key: i,
          ...Object.fromEntries(Object.entries(s.attrs).map(([k, v]) => [camel(k), v])),
        }),
      )}
    </svg>
  );
}

/**
 * 結果のカード（トレーディングカードの形）。珍しさは言葉のバッジ（星は店の評価に読まれるので使わない）。
 * spell が無いとき（友達のカード）は、注文の言葉と演出を出さない（URL に入るのはタイプだけ）。
 *
 * 演出は珍しさで変える（動かすのは transform と opacity だけ。動きを減らす設定では止める）。
 * 激レア: 虹色の光が表面を流れ続け、金の縁ときらめき、「激レア！」の判子。
 * レア: 銀の光が 1 回横切り、小さなきらめき。定番: 光らない代わりに、丼から湯気が立つ。
 */
export function Card({
  type,
  spell,
  small,
  headingId,
}: {
  type: AnyType;
  spell?: string;
  small?: boolean;
  headingId?: string;
}) {
  // カードの言葉は、そのタイプの版に合わせる（友達のカードは別の版のことがある。#410）。
  const { words } = editionOf(type.key);
  return (
    <article className={small ? styles.cardSmall : styles.card} data-rarity={rarity(type)}>
      {!small && <Effects level={rarity(type)} />}
      <div className={styles.cardTop}>
        <span
          className={!small && rarity(type) === "激レア" ? styles.rarityQuiet : styles.rarity}
          data-rarity={rarity(type)}
        >
          {rarity(type)}
        </span>
        <span>
          {words.combos} {type.combos} 通り
        </span>
      </div>
      {!small && rarity(type) === "定番" && <p className={styles.common}>{words.common}</p>}
      {spell && (
        <p className={styles.spell}>
          <span>{words.spell}</span>
          <strong>{spell}</strong>
        </p>
      )}
      <div className={styles.art}>
        {!small && rarity(type) === "定番" && (
          <span className={styles.steam} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
        <Face type={type} size={small ? 96 : 168} />
      </div>
      {small ? (
        <h3 className={styles.typeName}>{type.name}</h3>
      ) : (
        <h2 id={headingId} className={styles.typeName} tabIndex={-1} ref={(el) => el?.focus()}>
          {type.name}
        </h2>
      )}
      <p className={styles.catch}>{type.catch}</p>
    </article>
  );
}

/** カードの表面に重ねる光ときらめき・判子（飾りなので読み上げない）。 */
function Effects({ level }: { level: string }) {
  if (level === "定番") return null;
  const legend = level === "激レア";
  return (
    <span className={styles.effects} aria-hidden="true">
      <span className={legend ? styles.holo : styles.sheen} />
      {(legend ? ["a", "b", "c", "d"] : ["a", "b"]).map((k) => (
        <span key={k} className={styles.sparkle} data-at={k}>
          ✦
        </span>
      ))}
      {legend && <span className={styles.stamp}>激レア！</span>}
    </span>
  );
}
