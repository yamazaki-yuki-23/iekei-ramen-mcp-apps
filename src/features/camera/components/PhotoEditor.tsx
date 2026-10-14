import { useEffect, useMemo, useRef } from "react";
import styles from "../styles/camera.module.css";
import { Chips } from "./Chips";
import { compose, day, FRAMES, type Meta, type Rect } from "../lib/frames";
import type { Look } from "../utils/look";
import { applyEffect, EFFECTS } from "../lib/photo";

const inside = (v: number) => Math.min(0.95, Math.max(0.05, v));

/**
 * 写真の仕上げ（加工 × フレーム × 判子 × 右下の iekeiramen.com）。すべて端末の中の canvas。
 * 判子は、写真の上を指（またはマウス）でなぞると動き、矢印キーでも動かせる。大きさはつまみで変える。
 */
export function PhotoEditor({
  photo,
  canvas,
  look,
  onLook,
  stampText,
  meta,
}: {
  photo: ImageBitmap;
  canvas: React.RefObject<HTMLCanvasElement | null>;
  look: Look;
  onLook(look: Look): void;
  /** 判子にする文字（ひとことを選んでいなければ無し）。 */
  stampText: string | null;
  meta: Meta;
}) {
  // 加工は重いので、写真か加工を変えたときだけ作る。判子とフレームは毎回その上に重ねる。
  const base = useMemo(() => applyEffect(photo, look.effect), [photo, look.effect]);
  const rect = useRef<Rect | null>(null);
  const showStamp = look.stamp && stampText !== null;

  useEffect(() => {
    if (!canvas.current) return;
    rect.current = compose(canvas.current, base, {
      frame: look.frame,
      watermark: look.watermark,
      meta,
      stamp: showStamp ? { text: stampText, x: look.x, y: look.y, size: look.size } : null,
    });
  }, [canvas, base, look, meta, showStamp, stampText]);

  const moveTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current;
    const r = rect.current;
    if (!c || !r || !showStamp) return;
    const box = c.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * c.width;
    const py = ((e.clientY - box.top) / box.height) * c.height;
    onLook({ ...look, x: inside((px - r.x) / r.w), y: inside((py - r.y) / r.h) });
  };
  const keys = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!showStamp) return;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-0.03, 0],
      ArrowRight: [0.03, 0],
      ArrowUp: [0, -0.03],
      ArrowDown: [0, 0.03],
    };
    const d = step[e.key];
    if (!d) return;
    e.preventDefault();
    onLook({ ...look, x: inside(look.x + d[0]), y: inside(look.y + d[1]) });
  };

  return (
    <>
      <canvas
        ref={canvas}
        className={styles.preview}
        role="img"
        aria-label={showStamp ? "仕上げた写真。なぞるか矢印キーで判子を動かせます" : "仕上げた写真"}
        tabIndex={showStamp ? 0 : -1}
        onPointerDown={(e) => {
          if (!showStamp) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          moveTo(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) moveTo(e);
        }}
        onKeyDown={keys}
        data-stamp={showStamp || undefined}
      />
      <Chips
        label="加工"
        items={EFFECTS}
        value={look.effect}
        onChange={(v) => onLook({ ...look, effect: v ?? "none" })}
      />
      <Chips
        label="フレーム（店名・地域・日付が入る）"
        items={FRAMES}
        value={look.frame}
        onChange={(v) => onLook({ ...look, frame: v ?? "none" })}
      />
      {look.frame !== "none" && (
        <p className={styles.muted}>フレームの日付: {day(meta.date)}（写真のファイルの日付）</p>
      )}
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={look.stamp}
          onChange={(e) => onLook({ ...look, stamp: e.target.checked })}
        />
        ひとことを判子にして押す
      </label>
      {look.stamp && stampText === null && (
        <p className={styles.muted}>下の「ひとこと」を選ぶと、判子になります。</p>
      )}
      {showStamp && (
        <label className={styles.range}>
          判子の大きさ
          <input
            type="range"
            min={0.08}
            max={0.36}
            step={0.01}
            value={look.size}
            onChange={(e) => onLook({ ...look, size: Number(e.target.value) })}
          />
        </label>
      )}
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={look.watermark}
          onChange={(e) => onLook({ ...look, watermark: e.target.checked })}
        />
        右下に「iekeiramen.com」を入れる
      </label>
    </>
  );
}
