import { useCallback, useEffect, useRef, useState } from "react";
import { DATA_CREDIT } from "../../../utils/data-caveats";
import { formatDistance } from "../../../utils/geo";
import type { Shop } from "../../../types";
import type { createFeed } from "../../../lib/feed";
import styles from "../styles/camera.module.css";
import { ShopCaveat } from "./ShopCaveat";
import { Pending } from "../../../components/Pending";
import { useSlow } from "../../../hooks/use-slow";
import { skeletonShops } from "../../../utils/skeleton";
import { shopName } from "../../../utils/shop-name";

const SHOWN = 6;

/**
 * どの店で撮ったかを、近い順の候補から 1 軒選ぶ（写真から店を当てることはしない）。
 * 最初はおおよその現在地（#152）。違えば、ブラウザの位置か地名で探し直す。
 */
export function ShopPicker({
  feed,
  onPick,
  onRetake,
}: {
  /** 店を探す接続。ページで 1 つだけ作り、選び直しで作り足さない（前の接続が残り続けるため）。 */
  feed: ReturnType<typeof createFeed>;
  onPick(shop: Shop): void;
  onRetake(): void;
}) {
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [label, setLabel] = useState("");
  const loading = shops === null;
  const slow = useSlow(loading);
  // 骨組みは本物の札に仮の店を渡して描く。「ほかの店も見る」まで同じ形にする（7 軒以上ある前提）。
  const list = shops ?? skeletonShops("form").slice(0, SHOWN + 1);
  const [all, setAll] = useState(false);
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  // 探し直しが重なったら、最後に頼んだものだけを出す（遅れて返った古い結果で上書きしない）。
  const latest = useRef(0);
  useEffect(() => heading.current?.focus(), []);
  const show = useCallback(
    (
      asked: number,
      page: { shops: Shop[]; origin?: { label?: string } } | null,
      missing: string,
    ) => {
      if (asked !== latest.current) return;
      if (!page || page.shops.length === 0) {
        setShops((now) => now ?? []);
        setNote(missing);
        return;
      }
      setShops(page.shops);
      setLabel(page.origin?.label ?? "");
      setAll(false);
      setNote("");
    },
    [],
  );
  useEffect(() => {
    const asked = ++latest.current;
    // 選び直しで戻ってきたときは、さっき探した場所のまま出す（推定の場所へ戻さない）。
    feed.again().then(
      (page) =>
        show(asked, page, "近くの店が分かりませんでした。いまいる場所か地名で探してください。"),
      () =>
        show(asked, null, "近くの店を読み込めませんでした。いまいる場所か地名で探してください。"),
    );
  }, [feed, show]);
  const here = () => {
    const asked = ++latest.current;
    return feed.here().then(
      (page) => show(asked, page, "位置が分かりませんでした。地名で探してください。"),
      () => show(asked, null, "近くの店を読み込めませんでした。"),
    );
  };
  const search = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    const asked = ++latest.current;
    feed.fromPlace(query.trim()).then(
      (page) => show(asked, page, "その地名は見つかりませんでした。"),
      (err: Error) => show(asked, null, err.message),
    );
  };
  return (
    <section className={styles.step} aria-labelledby="shop-title">
      <h2 id="shop-title" tabIndex={-1} ref={heading}>
        どの店の一杯？
      </h2>
      {/*
       * 読み込み中も、一覧と同じ形の骨組みで場所を取る（#214）。届いても下の「いまいる場所で探し直す」や
       * 地名の欄が押し下げられない。300ms までは見せずに場所だけ取る。
       */}
      <Pending look={loading ? (slow ? "skeleton" : "reserve") : "live"}>
        {label || loading ? (
          <p className={styles.muted}>{label || "現在地"}から近い順（直線距離）</p>
        ) : null}
        <ul className={styles.shops}>
          {(all ? list : list.slice(0, SHOWN)).map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={styles.shop}
                onClick={() => {
                  // まだ返っていない検索に、選んだ候補の場所を書き換えさせない。
                  feed.settle();
                  onPick(s);
                }}
              >
                <strong>{shopName(s)}</strong>
                <span>
                  {s.city ?? s.prefecture}
                  {s.distanceKm !== undefined && `・直線 ${formatDistance(s.distanceKm)}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {list.length > 0 && <ShopCaveat />}
        {!all && list.length > SHOWN && (
          <button type="button" className={styles.link} onClick={() => setAll(true)}>
            ほかの店も見る（{list.length - SHOWN} 軒）
          </button>
        )}
      </Pending>
      {note && <p role="alert">{note}</p>}
      <div className={styles.row}>
        <button type="button" className={styles.btn} onClick={() => void here()}>
          いまいる場所で探し直す
        </button>
      </div>
      <form className={styles.place} onSubmit={search}>
        <label htmlFor="place">地名・駅名で探す</label>
        <div className={styles.row}>
          <input
            id="place"
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例: 横浜駅"
          />
          <button type="submit" className={styles.btn}>
            探す
          </button>
        </div>
      </form>
      <button type="button" className={styles.link} onClick={onRetake}>
        撮り直す
      </button>
      <p className={styles.note}>{DATA_CREDIT}</p>
    </section>
  );
}
