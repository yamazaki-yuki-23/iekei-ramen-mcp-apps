import { useCallback, useEffect, useRef, useState } from "react";
import { FEVER_MS, PREFETCH_AT, SWIPE_STEP } from "../lib/swipe";
import type { Origin, Shop } from "../lib/types";
import { createFeed } from "./client";
import type { Fx } from "./fx";
import { sound, unlock } from "./sound";
import { addMet, loadMet } from "./storage";

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

/** FEVER: ゲージが満タンで FEVER_MS。払う手数へのご褒美（店の良し悪しは表さない）。 */
export function useFever(fx: React.RefObject<Fx | null>, reduce: boolean) {
  const [gauge, setGauge] = useState(0);
  const [fever, setFever] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const charge = useCallback(
    (n: number) => {
      if (fever || reduce) return;
      const next = Math.min(100, gauge + n);
      setGauge(next);
      if (next < 100) return;
      setFever(true);
      fx.current?.startFever();
      sound.fever();
      vibrate([60, 40, 60]);
      timer.current = window.setTimeout(() => {
        void fx.current?.endFever().then(() => {
          setFever(false);
          setGauge(0);
        });
      }, FEVER_MS);
    },
    [fever, gauge, fx, reduce],
  );
  return { gauge, fever, charge };
}

/** 対応端末だけ短く振動させる。 */
export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // 振動できない端末では何もしない。
  }
}

/** 動きを減らす設定。 */
export function useReducedMotion() {
  const [reduce, setReduce] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const q = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** 今日出会った数。開いたまま 0 時を越えたら読み直す（次の 0 時と、画面に戻ってきたとき）。 */
export function useTodayCount() {
  const [met, setMet] = useState(loadMet);
  useEffect(() => {
    let timer = 0;
    const refresh = () => setMet(loadMet());
    const schedule = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = window.setTimeout(
        () => {
          refresh();
          schedule();
        },
        next.getTime() - now.getTime() + 1000,
      );
    };
    schedule();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const add = useCallback((delta: number) => setMet(addMet(delta)), []);
  return { met, add };
}

/**
 * キーボード: ← パス、→ 行きたい、Enter 今日はここ、Backspace 戻す。
 * Backspace は札が無いとき（全部見た・今日はここ の紙）でも戻せるようにし、ブラウザの「戻る」にさせない。
 */
export function useSwipeKeys(keys: {
  canUndo: boolean;
  canAct: boolean;
  onUndo: () => void;
  onFly: (dir: "want" | "pass") => void;
  onToday: () => void;
}) {
  const latest = useRef(keys);
  useEffect(() => {
    latest.current = keys;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      unlock();
      const k = latest.current;
      const target = e.target as HTMLElement;
      if (e.key === "Backspace") {
        if (target.closest("input, select, textarea") || !k.canUndo) return;
        e.preventDefault();
        k.onUndo();
        return;
      }
      const arrow = e.key === "ArrowLeft" || e.key === "ArrowRight";
      if ((!arrow && target.closest("input, a, button, select, textarea")) || !k.canAct) return;
      if (arrow) {
        e.preventDefault();
        k.onFly(e.key === "ArrowRight" ? "want" : "pass");
      } else if (e.key === "Enter") {
        e.preventDefault();
        k.onToday();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
