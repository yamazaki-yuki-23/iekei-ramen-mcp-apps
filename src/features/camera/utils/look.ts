import type { FrameKey } from "../lib/frames";
import type { EffectKey } from "../lib/photo";

/** 写真の仕上げの選び方（加工 × フレーム × 判子 × 右下の iekeiramen.com）。 */
export interface Look {
  effect: EffectKey;
  frame: FrameKey;
  watermark: boolean;
  stamp: boolean;
  /** 判子の真ん中（写真の中の 0〜1）と大きさ（写真の短い辺に対する文字の大きさ）。 */
  x: number;
  y: number;
  size: number;
}

export const FIRST_LOOK: Look = {
  effect: "none",
  frame: "none",
  watermark: true,
  stamp: true,
  x: 0.72,
  y: 0.2,
  size: 0.16,
};
