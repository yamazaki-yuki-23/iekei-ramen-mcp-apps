import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { distanceKm, originLabel } from "../lib/geo";
import { factStamp } from "../lib/shop-facts";
import { askForScreen, chargeFor, SWIPE_STEP, type SwipeDir } from "../lib/swipe";
import type { Origin, Shop, TasteKey } from "../lib/types";
import { CardStack, type StackHandle } from "./CardStack";
import { createFx, type Fx } from "./fx";
import { useFeed, useFever, useReducedMotion, useSwipeKeys, useTodayCount, vibrate } from "./hooks";
import { AskLine, Controls, Counter, Gauge, Header } from "./Parts";
import { EndSheet, PlaceSheet, StatusSheet, TodaySheet, WantsSheet } from "./Sheets";
import { sound, unlock } from "./sound";
import { loadWants, saveWants } from "./storage";
import styles from "./swipe.module.css";

/** 行きたいリストの距離は、いまの基準地点から測り直す（前に選んだ場所の距離を使い回さない）。 */
function withDistance(wants: Shop[], origin?: Origin): Shop[] {
  return wants.map(({ distanceKm: _old, ...shop }) =>
    origin
      ? {
          ...shop,
          distanceKm: Number(distanceKm(origin.lat, origin.lon, shop.lat, shop.lon).toFixed(3)),
        }
      : shop,
  );
}

type View = "cards" | "today" | "wants";
interface Step {
  pos: number;
  dir: SwipeDir;
  shop: Shop;
  wantStreak: number;
  passStreak: number;
  /** この払いで行きたいリストに足したか。前から入っていた店なら、戻しても消さない。 */
  added: boolean;
}

/**
 * 家系マッチ（#166）。近い順に家系の食券を 1 枚ずつ払い、知らない店に出会う。
 * 右に払うと「行きたい」、左に払うとパス、「今日はここ」でその場で決まり。何軒で終えてもよい。
 * 見終わったら「範囲を広げる」か「行きたいリストを見る」で区切る（無限には続けない）。
 */
export function SwipeApp() {
  const reduce = useReducedMotion();
  const { shops, origin, status, exhausted, failed, prefetch, retry, searchPlace } = useFeed();
  const fxLayer = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const fx = useRef<Fx | null>(null);
  const stack = useRef<StackHandle>(null);
  const { gauge, fever, charge } = useFever(fx, reduce);

  const [taste, setTaste] = useState<TasteKey | "">("");
  const [rangeEnd, setRangeEnd] = useState(SWIPE_STEP);
  const [pos, setPos] = useState(0);
  const [history, setHistory] = useState<Step[]>([]);
  const [wants, setWants] = useState<Shop[]>(loadWants);
  const { met, add: addToday } = useTodayCount();
  const [wantStreak, setWantStreak] = useState(0);
  const [passStreak, setPassStreak] = useState(0);
  const [flipIn, setFlipIn] = useState(false);
  const [view, setView] = useState<View>("cards");
  const [today, setToday] = useState<Shop | null>(null);
  // 札が飛んでいる間（決まるまで）。戻す・今日はここ を止め、履歴を食い違わせない。
  const [flying, setFlying] = useState(false);

  useEffect(() => {
    if (fxLayer.current && appRef.current) fx.current ??= createFx(fxLayer.current, appRef.current);
  }, []);

  const deck = useMemo(() => shops.filter((s) => !taste || s.taste === taste), [shops, taste]);
  const visible = deck.slice(0, rangeEnd);
  const current = visible[pos];
  const ended = status === "ready" && view === "cards" && !current;

  useEffect(() => prefetch(pos, rangeEnd, deck.length), [pos, rangeEnd, deck.length, prefetch]);

  const decide = (dir: SwipeDir) => {
    const shop = visible[pos];
    if (!shop) return;
    const nextWant = dir === "want" ? wantStreak + 1 : 0;
    const added = dir === "want" && !wants.some((w) => w.id === shop.id);
    setFlying(false);
    setHistory((h) => [...h, { pos, dir, shop, wantStreak, passStreak, added }]);
    setWantStreak(nextWant);
    setPassStreak(dir === "pass" ? passStreak + 1 : 0);
    if (added) {
      const next = [...wants, shop];
      setWants(next);
      saveWants(next);
    }
    addToday(1);
    fx.current?.burst(dir, nextWant);
    fx.current?.settle();
    fx.current?.shake(dir === "want" ? 2 + Math.min(nextWant, 5) : 1.5);
    void sound.swipe(dir);
    vibrate(dir === "want" ? 25 + Math.min(nextWant, 5) * 8 : 12);
    if ((history.length + 1) % 5 === 0) fx.current?.confetti();
    charge(chargeFor(dir, (shop.facts?.length ?? 0) > 0));
    setFlipIn(true);
    setPos(pos + 1);
  };

  const undo = () => {
    const last = history.at(-1);
    if (!last || flying) return;
    setHistory(history.slice(0, -1));
    if (last.added) {
      const next = wants.filter((w) => w.id !== last.shop.id);
      setWants(next);
      saveWants(next);
    }
    addToday(-1);
    setWantStreak(last.wantStreak);
    setPassStreak(last.passStreak);
    setFlipIn(false);
    setPos(last.pos);
    setView("cards");
  };

  // レア札: めくった瞬間に金の縁が灯り、光が 1 回走り、理由の判子が叩きつけられる。
  const revealed = useCallback(
    (shop: Shop, el: HTMLElement) => {
      const facts = shop.facts ?? [];
      if (facts.length === 0) return;
      const gold = el.querySelector(`.${styles.gold}`) as HTMLElement | null;
      if (reduce || !flipIn) {
        if (gold) gold.style.opacity = "1";
        return;
      }
      gold?.animate(
        [
          { opacity: 0, transform: "scale(1.06)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: 380, easing: "ease-out", fill: "forwards" },
      );
      const shine = el.querySelector(`.${styles.shine}`);
      if (shine) {
        const band = document.createElement("div");
        band.className = styles.shineBand;
        shine.appendChild(band);
        band.animate(
          [
            { transform: "translateX(-160%) skewX(-12deg)" },
            { transform: "translateX(320%) skewX(-12deg)" },
          ],
          { duration: 700, easing: "ease-in-out" },
        ).onfinish = () => band.remove();
      }
      fx.current?.slam(factStamp(facts[0]));
      fx.current?.shake(7);
      sound.rare();
      vibrate([40, 30, 90]);
    },
    [reduce, flipIn],
  );

  const chooseTaste = (next: TasteKey | "") => {
    // 札が飛んでいる間は変えない（遅れて届く決定が、絞り直した山の位置を壊す）。
    if (flying) return;
    setTaste(next);
    setPos(0);
    setRangeEnd(SWIPE_STEP);
    setHistory([]);
    setPassStreak(0);
    setFlipIn(false);
  };

  const decideToday = () => {
    if (!current || flying) return;
    sound.issue();
    vibrate([30, 20, 50]);
    setToday(current);
    setView("today");
  };

  useSwipeKeys({
    canUndo: history.length > 0 && !flying,
    canAct: view === "cards" && Boolean(current),
    onUndo: undo,
    onFly: (dir) => stack.current?.fly(dir),
    onToday: decideToday,
  });

  const ask = askForScreen({
    view,
    ended,
    failedEnd: failed && deck.length <= rangeEnd,
    current,
    pos,
    seen: history.length,
    passStreak,
    rest: visible.slice(pos + 1),
    total: visible.length,
  });

  const body = (() => {
    if (status === "loading")
      return <StatusSheet title="近くの家系を探しています" text="少し待ってください。" />;
    if (status === "error")
      return (
        <StatusSheet
          title="読み込めませんでした"
          text="通信の状態を確かめて、もう一度開いてください。"
          action={
            <a className={styles.btn} href="/match/">
              もう一度開く
            </a>
          }
        />
      );
    if (view === "today" && today)
      return <TodaySheet shop={today} onBack={() => setView("cards")} />;
    if (view === "wants")
      return (
        <WantsSheet
          wants={withDistance(wants, origin)}
          origin={origin}
          onBack={() => setView("cards")}
          onClear={() => {
            setWants([]);
            saveWants([]);
          }}
        />
      );
    // 場所が分からなくても、残してある「行きたい」は開ける。
    if (status === "noplace") return <PlaceSheet onSearch={searchPlace} />;
    if (ended)
      return (
        <EndSheet
          count={visible.length}
          more={deck.length > rangeEnd || !exhausted}
          failed={failed && deck.length <= rangeEnd}
          onRetry={retry}
          onWider={() => setRangeEnd(rangeEnd + SWIPE_STEP)}
          onWants={() => setView("wants")}
        />
      );
    return (
      <CardStack
        ref={stack}
        cards={visible.slice(pos, pos + 3)}
        firstNumber={pos + 1}
        flipIn={flipIn}
        reduce={reduce}
        onDecide={decide}
        onFly={() => setFlying(true)}
        onLean={(dx, p) => fx.current?.lean(dx, p)}
        onSettle={() => fx.current?.settle()}
        onRevealed={revealed}
      />
    );
  })();

  const canSwipe = status === "ready" && view === "cards" && Boolean(current) && !flying;
  return (
    <div className={`${styles.page} ${fever ? styles.feverOn : ""}`} onPointerDown={unlock}>
      <div className={styles.fx} ref={fxLayer} aria-hidden="true" />
      <main className={styles.app} ref={appRef}>
        <Header
          place={origin ? originLabel(origin) : ""}
          wants={wants.length}
          onWants={() => setView("wants")}
        />
        <Counter value={met} reduce={reduce} />
        <Gauge value={gauge} fever={fever} />
        <AskLine
          ask={ask}
          taste={taste}
          onTaste={chooseTaste}
          tasteLocked={flying}
          combo={wantStreak}
          reduce={reduce}
        />
        <div className={styles.stage}>{body}</div>
        <Controls
          canSwipe={canSwipe}
          canUndo={history.length > 0 && !flying}
          onFly={(dir) => stack.current?.fly(dir)}
          onUndo={undo}
          onToday={decideToday}
        />
      </main>
    </div>
  );
}
