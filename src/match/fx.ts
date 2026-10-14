import type { SwipeDir } from "../lib/swipe";
import styles from "./swipe.module.css";

/*
 * 家系マッチの演出（#166。オーナーの指示「ドパガキ効果」「画面全体で」「FEVER」）。
 *
 * - **札の後ろ（背景の層）だけで動かす。** 札は不透明なので、文字は読めるまま
 * - 動かすのは transform と opacity だけ。点滅はしない（明るさは 0.8〜1.5 秒かけて変える）
 * - 動きを減らす設定では何もしない（呼ばれても返る）。CSS でも層ごと隠す
 * - 湯気・紙吹雪・炎の位置は決まった配置（乱数は使わない）
 *
 * DESIGN.md「家系マッチ」の例外: ほかの画面では光彩・グラデーションを使わない。ここだけの決まり。
 */

const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function spawn(parent: HTMLElement, className: string, style: Partial<CSSStyleDeclaration> = {}) {
  const el = document.createElement("div");
  el.className = className;
  Object.assign(el.style, style);
  parent.appendChild(el);
  return el;
}

const TOPPINGS = [
  '<svg viewBox="0 0 20 20" width="26" height="26" aria-hidden="true"><rect x="3" y="1" width="14" height="18" rx="1" fill="#1d2b22"/></svg>',
  '<svg viewBox="0 0 20 20" width="26" height="26" aria-hidden="true"><path d="M10 1C4 6 4 14 10 19C16 14 16 6 10 1Z" fill="#3f8a3a"/></svg>',
  '<svg viewBox="0 0 20 20" width="26" height="26" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#c98a6b"/><circle cx="10" cy="10" r="5" fill="#e8c2a8"/></svg>',
];

/** 明るさをゆっくり変える（急に明るくしない）。 */
const fade = (el: HTMLElement, to: number, duration: number) =>
  el
    .animate([{ opacity: getComputedStyle(el).opacity }, { opacity: to }], {
      duration,
      easing: "ease-out",
      fill: "forwards",
    })
    .finished.then((a) => {
      el.style.opacity = String(to);
      a.cancel();
    })
    .catch(() => {});

export interface Fx {
  lean(dx: number, p: number): void;
  settle(): void;
  burst(dir: SwipeDir, streak: number): void;
  confetti(): void;
  shake(amount: number): void;
  slam(text: string): void;
  startFever(): void;
  endFever(): Promise<void>;
}

export function createFx(layer: HTMLElement, app: HTMLElement): Fx {
  const heat = spawn(layer, styles.heat);
  const dull = spawn(layer, styles.dull);
  const rays = spawn(layer, styles.rays);
  let fever = false;
  let flameTimer = 0;
  let spin: Animation | null = null;

  const steam = (n: number) => {
    for (let i = 0; i < n; i++) {
      const w = spawn(layer, styles.steam, { left: `${10 + ((i * 37) % 80)}%` });
      w.animate(
        [
          { transform: "translateY(0) scaleX(0.8)", opacity: 0 },
          { opacity: 0.55, offset: 0.35 },
          { transform: `translateY(-${380 + i * 40}px) scaleX(1.3)`, opacity: 0 },
        ],
        { duration: 1600 + i * 120, delay: i * 90, easing: "ease-out" },
      ).onfinish = () => w.remove();
    }
  };

  return {
    // 払っている間: 右ほど画面全体が熱くなり、左ほど沈む。
    lean(dx, p) {
      if (reduce()) return;
      heat.style.opacity = String(fever ? Math.max(0.6, dx > 0 ? p : 0.6) : dx > 0 ? p : 0);
      dull.style.opacity = String(dx < 0 ? p : 0);
    },
    settle() {
      if (reduce()) return;
      void fade(heat, fever ? 0.6 : 0, 500);
      void fade(dull, 0, 500);
    },
    // 決まった瞬間: 払った側から画面全体へ光がゆっくり広がり、波紋 1 回・湯気。コンボで強くなる。
    burst(dir, streak) {
      if (reduce()) return;
      const side = dir === "want" ? "100%" : "0%";
      const glow = spawn(layer, dir === "want" ? styles.glow : styles.glowDull, { left: side });
      glow.animate(
        [
          { transform: "scale(0.15)", opacity: 0 },
          { opacity: 0.9, offset: 0.35 },
          { transform: "scale(1)", opacity: 0 },
        ],
        { duration: 900, easing: "ease-out" },
      ).onfinish = () => glow.remove();
      const ring = spawn(layer, dir === "want" ? styles.ripple : styles.rippleDull, {
        left: side,
        borderWidth: `${3 + Math.min(streak, 5)}px`,
      });
      ring.animate(
        [
          { transform: "scale(0.2)", opacity: 0.7 },
          { transform: "scale(5)", opacity: 0 },
        ],
        { duration: 650, easing: "cubic-bezier(.2,.7,.3,1)" },
      ).onfinish = () => ring.remove();
      steam(dir === "want" ? Math.min(1 + streak, 8) : 1);
    },
    // 5 枚ごと: 海苔・ほうれん草・チャーシューが見出しの帯に開いて、左右の端へ落ちる。
    confetti() {
      if (reduce()) return;
      for (let i = 0; i < 18; i++) {
        const t = spawn(layer, styles.topping);
        t.innerHTML = TOPPINGS[i % 3];
        const side = i % 2 ? 1 : -1;
        const k = Math.floor(i / 2);
        const x = side * (25 + k * 21);
        const up = 10 + (k % 3) * 14;
        const fall = 300 + (k % 5) * 60;
        t.animate(
          [
            { transform: "translate(-50%, -50%) scale(0.4) rotate(0deg)", opacity: 0 },
            {
              transform: `translate(calc(-50% + ${x}px), calc(-50% + ${up}px)) scale(1) rotate(${side * 120}deg)`,
              opacity: 1,
              offset: 0.35,
            },
            {
              transform: `translate(calc(-50% + ${x * 1.05}px), calc(-50% + ${fall}px)) scale(0.9) rotate(${side * 300}deg)`,
              opacity: 0,
            },
          ],
          { duration: 1500 + (k % 3) * 150, easing: "cubic-bezier(.2,.6,.4,1)" },
        ).onfinish = () => t.remove();
      }
    },
    shake(a) {
      if (reduce()) return;
      app.animate(
        [
          { transform: "translateX(0)" },
          { transform: `translateX(${-a}px)` },
          { transform: `translateX(${a}px)` },
          { transform: `translateX(${-a / 2}px)` },
          { transform: "translateX(0)" },
        ],
        { duration: 220, easing: "ease-out" },
      );
    },
    // レア札: 理由の判子が画面いっぱいに叩きつけられる（約 1 秒で消える。読み上げは札の文字が持つ）。
    slam(text) {
      if (reduce()) return;
      const el = spawn(document.body, styles.slam);
      el.setAttribute("aria-hidden", "true");
      el.textContent = text;
      el.animate(
        [
          { transform: "translate(-50%, -50%) scale(3.2) rotate(-14deg)", opacity: 0 },
          {
            transform: "translate(-50%, -50%) scale(0.92) rotate(-8deg)",
            opacity: 1,
            offset: 0.18,
          },
          { transform: "translate(-50%, -50%) scale(1) rotate(-8deg)", opacity: 1, offset: 0.7 },
          { transform: "translate(-50%, -50%) scale(1.05) rotate(-8deg)", opacity: 0 },
        ],
        { duration: 1000, easing: "cubic-bezier(.2,.9,.3,1)" },
      ).onfinish = () => el.remove();
    },
    // FEVER: 中心から回る光の筋（茶赤と金）と、画面の左右の端から炎と湯気。
    startFever() {
      fever = true;
      if (reduce()) return;
      spin = rays.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], {
        duration: 9000,
        iterations: Infinity,
      });
      void fade(rays, 1, 800);
      heat.style.opacity = "0.6";
      let k = 0;
      flameTimer = window.setInterval(() => {
        const edge = k % 2 ? 100 - ((k * 7) % 22) : (k * 7) % 22;
        const f = spawn(layer, styles.flame, { left: `calc(${edge}% - 30px)` });
        f.animate(
          [
            { transform: "translateY(0) scale(0.7)", opacity: 0 },
            { opacity: 0.9, offset: 0.3 },
            { transform: `translateY(-${260 + (k % 4) * 60}px) scale(1.2)`, opacity: 0 },
          ],
          { duration: 1400, easing: "ease-out" },
        ).onfinish = () => f.remove();
        if (k % 3 === 0) steam(2);
        k++;
      }, 260);
    },
    // ゆっくり元に戻る（1.5 秒）。
    async endFever() {
      window.clearInterval(flameTimer);
      if (!reduce()) {
        void fade(heat, 0, 1500);
        await fade(rays, 0, 1500);
        spin?.cancel();
      }
      fever = false;
    },
  };
}
