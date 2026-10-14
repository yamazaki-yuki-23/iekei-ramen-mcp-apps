import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { SwipeDir } from "../lib/swipe";
import type { Shop } from "../lib/types";
import styles from "./swipe.module.css";
import { TicketCard } from "./TicketCard";

export interface StackHandle {
  /** ボタン・キーボードから払う。 */
  fly(dir: SwipeDir): void;
}

interface Props {
  /** 上の札から順に、最大 3 枚。 */
  cards: Shop[];
  /** 上の札の番号（1 始まり）。 */
  firstNumber: number;
  /** 上の札を裏からめくって出すか（払った直後だけ）。 */
  flipIn: boolean;
  reduce: boolean;
  onDecide(dir: SwipeDir): void;
  /** 札が飛び始めた（決まるまでの約 220ms、ほかの操作を止めるため）。 */
  onFly(): void;
  onLean(dx: number, p: number): void;
  onSettle(): void;
  /** 上の札がめくれ終わった（レア札の演出を始める合図）。 */
  onRevealed(shop: Shop, el: HTMLElement): void;
  ref?: Ref<StackHandle>;
}

/** 下の札の位置。上を払うほど（p が 1 に近いほど）前に出る。 */
const depthTransform = (depth: number) => `translateY(${depth * 10}px) scale(${1 - depth * 0.05})`;

/**
 * 食券の山。上の 1 枚だけが指に 1 対 1 で付いてくる（位置と傾きだけ、transform）。
 * 画面幅の 3 割か素早い弾きで決まり、足りなければばねのように戻る。
 * 動いている間は React で描き直さず、要素の style を直接変える（カクつかせない）。
 */
export function CardStack({
  cards,
  firstNumber,
  flipIn,
  reduce,
  onDecide,
  onFly,
  onLean,
  onSettle,
  onRevealed,
  ref,
}: Props) {
  const stackRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLElement>(null);
  const flying = useRef(false);
  const top = cards[0];
  // めくり終えた上の札。class を手で外すと次の描画で戻るので、状態で持つ。
  const [revealed, setRevealed] = useState<string | null>(null);

  const parts = () => {
    const card = topRef.current;
    // DOM は下の札から並ぶ（上の札がいちばん後ろ＝手前）。浅い順に並べ直す。
    const under = (
      [...(stackRef.current?.children ?? [])].filter((c) => c !== card) as HTMLElement[]
    ).toReversed();
    return { card, under };
  };

  const paint = (dx: number, dy: number) => {
    const { card, under } = parts();
    if (!card || !stackRef.current) return;
    const width = stackRef.current.clientWidth;
    const p = Math.min(Math.abs(dx) / (width * 0.3), 1);
    const tilt = Math.max(-8, Math.min(8, (dx / width) * 16));
    card.style.transform = `translate(${dx}px, ${dy * 0.15}px) rotate(${tilt}deg)`;
    (card.querySelector('[data-stamp="want"]') as HTMLElement).style.opacity = String(
      dx > 0 ? p : 0,
    );
    (card.querySelector('[data-stamp="pass"]') as HTMLElement).style.opacity = String(
      dx < 0 ? p : 0,
    );
    under.forEach((u, i) => (u.style.transform = depthTransform(i + 1 - p)));
    onLean(dx, p);
  };

  const fly = (dir: SwipeDir, velocity = 0, dy = 0) => {
    const { card, under } = parts();
    if (!card || !stackRef.current || flying.current) return;
    flying.current = true;
    onFly();
    if (reduce) {
      onDecide(dir);
      return;
    }
    const out = (dir === "want" ? 1 : -1) * stackRef.current.clientWidth * 1.4;
    card.style.transition = `transform ${Math.max(160, 300 - Math.abs(velocity) * 80)}ms cubic-bezier(.3,.7,.4,1)`;
    (card.querySelector(`[data-stamp="${dir}"]`) as HTMLElement).style.opacity = "1";
    card.style.transform = `translate(${out}px, ${dy * 0.15}px) rotate(${dir === "want" ? 14 : -14}deg)`;
    under.forEach((u, i) => {
      u.style.transition = "transform 260ms ease-out";
      u.style.transform = depthTransform(i);
    });
    window.setTimeout(() => onDecide(dir), 220);
  };

  useImperativeHandle(ref, () => ({ fly: (dir) => fly(dir) }));

  // 指の操作は札が替わったときだけ付け直すので、払う処理はいつも最新のものを呼ぶ
  // （味で絞っても上の札が同じだと、古い位置のまま決めてしまう）。
  const latest = useRef({ fly, paint, onSettle, reduce });
  useEffect(() => {
    latest.current = { fly, paint, onSettle, reduce };
  });

  // 指に付いてくる操作。新しい上の札ごとに付け直す。
  useEffect(() => {
    flying.current = false;
    const card = topRef.current;
    if (!card) return;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dy = 0;
    let lastX = 0;
    let lastT = 0;
    let vx = 0;
    let dragging = false;
    const down = (e: PointerEvent) => {
      if (flying.current) return;
      dragging = true;
      card.setPointerCapture(e.pointerId);
      startX = lastX = e.clientX;
      startY = e.clientY;
      lastT = e.timeStamp;
      vx = 0;
      card.style.transition = "none";
      for (const u of parts().under) u.style.transition = "none";
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      dx = e.clientX - startX;
      dy = e.clientY - startY;
      vx = (e.clientX - lastX) / (e.timeStamp - lastT || 1);
      lastX = e.clientX;
      lastT = e.timeStamp;
      latest.current.paint(dx, dy);
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      const width = stackRef.current?.clientWidth ?? 1;
      if (Math.abs(dx) > width * 0.3 || Math.abs(vx) > 0.6) {
        latest.current.fly(dx > 0 || (dx === 0 && vx > 0) ? "want" : "pass", vx, dy);
        return;
      }
      // 足りなければ、ばねのように元へ戻る。
      card.style.transition = latest.current.reduce
        ? "none"
        : "transform 420ms cubic-bezier(.2,1.6,.4,1)";
      for (const u of parts().under)
        u.style.transition = latest.current.reduce ? "none" : "transform 300ms ease-out";
      dx = 0;
      dy = 0;
      latest.current.paint(0, 0);
      latest.current.onSettle();
    };
    card.addEventListener("pointerdown", down);
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerup", up);
    card.addEventListener("pointercancel", up);
    return () => {
      card.removeEventListener("pointerdown", down);
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerup", up);
      card.removeEventListener("pointercancel", up);
    };
    // 上の札が替わったときだけ付け直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top?.id]);

  // 払った直後の上の札は裏から始め、めくる。めくれ終わったらレア札の演出の合図を出す。
  useEffect(() => {
    const card = topRef.current;
    if (!card || !top) return;
    if (!flipIn || reduce) {
      onRevealed(top, card);
      return;
    }
    let timer = 0;
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setRevealed(top.id);
        timer = window.setTimeout(() => onRevealed(top, card), 300);
      }),
    );
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top?.id]);

  return (
    <div className={styles.stack} ref={stackRef}>
      {cards
        .map((shop, depth) => (
          <TicketCard
            key={shop.id}
            ref={depth === 0 ? topRef : undefined}
            shop={shop}
            number={firstNumber + depth}
            down={depth > 0 || (flipIn && !reduce && revealed !== shop.id)}
            hidden={depth > 0}
            style={{ transform: depthTransform(depth) }}
          />
        ))
        .toReversed()}
    </div>
  );
}
