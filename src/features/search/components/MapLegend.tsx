import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CLUSTER_SIZES,
  drawCluster,
  drawPin,
  drawSelected,
  drawVisitedPin,
  imageUrl,
} from "../lib/map-images";
import styles from "../styles/search.module.css";

/**
 * 地図の印の見方（#246、デザイナーの見本）。地図の右上の「?」で開く、地図の上に重ねる札。
 *
 * **MapLibre の外の DOM で作る。** 地図の部品にすると、読み上げとキーボードで扱えない。
 * 閉じ方は「閉じる」・Esc・札の外を押す。開いたら見出しへ、閉じたら「?」へ焦点を移す。
 * 動きは付けない。味や評判の言葉、家系判定の段階は出さない。
 */
export function MapLegend() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const openerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /*
   * 閉じたら「?」へ焦点を戻す。**「?」を描いた後で戻す**（閉じた瞬間はまだ札が出ていて、
   * 「?」が無い）。札の外を押して閉じたときは戻さない（別の所を押した人の焦点を奪わない）。
   */
  const returnFocus = useRef(false);
  // 開くまで絵を描かない（地図を開くたびに canvas を使わない）。
  const images = useMemo(() => (open ? legendImages() : null), [open]);

  useEffect(() => {
    if (!open) {
      if (returnFocus.current) openerRef.current?.focus();
      returnFocus.current = false;
      return;
    }
    headingRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      returnFocus.current = true;
      setOpen(false);
    };
    const onPress = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress, true);
    };
  }, [open]);

  if (!open || !images)
    return (
      <button
        ref={openerRef}
        type="button"
        className={styles.legendOpener}
        aria-label="地図の印の見方"
        aria-expanded={false}
        aria-controls={panelId}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">?</span>
      </button>
    );

  return (
    <div ref={panelRef} id={panelId} className={styles.legend}>
      <h3 ref={headingRef} tabIndex={-1} className={styles.legendTitle}>
        地図の印
      </h3>
      <button
        type="button"
        className={styles.legendClose}
        aria-expanded={true}
        aria-controls={panelId}
        onClick={() => {
          returnFocus.current = true;
          setOpen(false);
        }}
      >
        閉じる
      </button>
      <ul className={styles.legendList}>
        <Item src={images.rich}>味が濃厚</Item>
        <Item src={images.creamy}>味がクリーミー</Item>
        <Item src={images.chain}>チェーン店</Item>
        <Item src={images.unknown}>味はまだ分けていない</Item>
      </ul>
      <p className={styles.legendNote}>味の分け方は参考です。</p>
      <ul className={styles.legendList}>
        <Item src={images.stop}>まわる順の何軒目か</Item>
        <Item src={images.cluster}>この辺りの店の数（押すと寄る）</Item>
        <Item src={images.selected}>選んでいる店</Item>
        {/* 記録が無いときも出す（印の意味は、記録する前に知れた方が良い）。 */}
        <Item src={images.visited}>行った店（記録した店）</Item>
      </ul>
    </div>
  );
}

function Item({ src, children }: { src: string; children: string }) {
  return (
    <li className={styles.legendItem}>
      <img src={src} alt="" width={44} height={44} />
      {children}
    </li>
  );
}

function legendImages() {
  const [, r] = CLUSTER_SIZES[0];
  return {
    rich: imageUrl(44, 44, drawPin("rich")),
    creamy: imageUrl(44, 44, drawPin("creamy")),
    chain: imageUrl(44, 44, drawPin("chain")),
    unknown: imageUrl(44, 44, drawPin("unknown")),
    stop: imageUrl(44, 44, drawPin("unknown", 1)),
    cluster: imageUrl(r * 2 + 14, r * 2 + 14, drawCluster(r)),
    selected: imageUrl(60, 60, drawSelected("unknown")),
    visited: imageUrl(44, 44, drawVisitedPin),
  };
}
