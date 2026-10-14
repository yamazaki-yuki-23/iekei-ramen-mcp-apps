import { useCallback, useEffect, useRef, useState } from "react";
import { PREFETCH_AT } from "../utils/swipe";
import { SWIPE_STEP } from "../../../lib/feed";
import type { Origin, Shop } from "../../../types";
import { createFeed } from "../../../lib/feed";

type Status = "loading" | "ready" | "noplace" | "error";

/**
 * 近い順の店を、SWIPE_STEP 軒ずつ取る。いまの範囲の残りが PREFETCH_AT 枚になったら
 * 次の範囲を先に取っておき、「範囲を広げる」で待たせない。
 */
export function useFeed() {
  const feed = useRef<ReturnType<typeof createFeed> | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [origin, setOrigin] = useState<Origin>();
  const [status, setStatus] = useState<Status>("loading");
  const [exhausted, setExhausted] = useState(false);
  // 続きの取得に失敗した。終わり（exhausted）とは分ける: 一時の失敗で「全部見た」にしない。
  const [failed, setFailed] = useState(false);
  const fetching = useRef(false);

  useEffect(() => {
    feed.current ??= createFeed();
    let active = true;
    feed.current
      .first()
      .then((page) => {
        if (!active) return;
        setShops(page.shops);
        setOrigin(page.origin);
        setExhausted(page.shops.length < SWIPE_STEP);
        setStatus(page.shops.length > 0 ? "ready" : page.origin ? "ready" : "noplace");
      })
      .catch(() => active && setStatus("error"));
    return () => {
      active = false;
    };
  }, []);

  const loadMore = useCallback(() => {
    if (fetching.current || !feed.current) return;
    fetching.current = true;
    feed.current
      .next(shops.length)
      .then((page) => {
        setFailed(false);
        setShops((now) => {
          const seen = new Set(now.map((n) => n.id));
          return [...now, ...page.shops.filter((s) => !seen.has(s.id))];
        });
        if (page.shops.length < SWIPE_STEP) setExhausted(true);
      })
      // 失敗は覚えておき、押されたら取り直す（retry）。勝手に繰り返さない。
      .catch(() => setFailed(true))
      .finally(() => {
        fetching.current = false;
      });
  }, [shops.length]);

  /** 位置 pos の札を見ているとき、範囲 end の残りが少なければ次を取る。 */
  const prefetch = useCallback(
    (pos: number, end: number, deckLength: number) => {
      const visible = Math.min(end, deckLength);
      if (exhausted || failed) return;
      if (pos < visible - PREFETCH_AT || shops.length >= end + SWIPE_STEP) return;
      loadMore();
    },
    [exhausted, failed, shops.length, loadMore],
  );

  /** 地名から探し直す。見つからなければ false（画面が言い分ける）。失敗は投げる。 */
  const searchPlace = useCallback(async (query: string) => {
    if (!feed.current) return false;
    const page = await feed.current.fromPlace(query);
    if (!page) return false;
    setShops(page.shops);
    setOrigin(page.origin);
    setExhausted(page.shops.length < SWIPE_STEP);
    setFailed(false);
    setStatus("ready");
    return true;
  }, []);

  return { shops, origin, status, exhausted, failed, prefetch, retry: loadMore, searchPlace };
}
