import { createElement } from "react";
import type { AnyType } from "../../../utils/shindan-editions";
import { faceShapes } from "../../../utils/shindan-face";

const camel = (k: string) => k.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

/** 丼のキャラクター（タイプごとに表情が変わる）。飾りなので読み上げない。 */
export function Face({ type, size }: { type: AnyType; size: number }) {
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
