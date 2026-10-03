import { describe, expect, it } from "vitest";
import data from "../data/shops.json" with { type: "json" };
import { clusterShops } from "../src/lib/cluster";
import type { Shop } from "../src/lib/types";
import { clusterShops as reference } from "./fixtures/cluster-reference";

const shops = data as Shop[];
const atPixel = (id: string, x: number, y = 1_650_000): Shop => {
  const scale = 256 * 2 ** 14;
  return {
    id,
    name: id,
    taste: "unknown",
    confidence: "confirmed",
    prefecture: "神奈川県",
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI,
    lon: (x / scale) * 360 - 180,
    osmUrl: `https://example.test/${id}`,
  };
};
// 升目の境界と索引の境界をまたぎ、何度も統合して中心が動く固定データ。
const synthetic = Array.from({ length: 80 }, (_, i) => {
  const edge = 3_700_032 + i * 128;
  return [
    atPixel(`a-${i}`, edge - 2),
    atPixel(`b-${i}`, edge + 2),
    atPixel(`c-${i}`, edge + 32),
    atPixel(`d-${i}`, edge + 64),
  ];
}).flat();
const boundary = [35.999999, 36, 36.000001, -35.999999, -36, -36.000001].flatMap((gap, i) => [
  atPixel(`edge-a-${i}`, 3_700_032 + i * 256 - 1),
  atPixel(`edge-b-${i}`, 3_700_032 + i * 256 - 1 + gap),
]);
const datasets = {
  real: shops,
  synthetic,
  // 候補が複数あるとき、索引のセル順ではなく入力順で組を選ぶ。
  reversed: synthetic.toReversed(),
  reordered: [
    ...synthetic.filter((_, i) => i % 2 === 0),
    ...synthetic.filter((_, i) => i % 2 !== 0),
  ],
  boundary: [...synthetic, ...boundary],
  recenter: [
    // 後ろの2組を統合すると、先頭との距離が約39pxから35pxへ縮む。
    atPixel("earlier", 3_700_032, 1_650_048 + 34),
    atPixel("merge-left", 3_700_032 - 17, 1_650_048 - 1),
    atPixel("merge-right", 3_700_032 + 17, 1_650_048 - 1),
    ...synthetic.map((shop) => ({ ...shop, lon: shop.lon + 2 })),
  ],
  poles: [
    { ...atPixel("north", 0), lat: 89 },
    { ...atPixel("south", 0), lat: -89 },
    { ...atPixel("west", 0), lon: -179.999 },
    { ...atPixel("east", 0), lon: 179.999 },
  ],
  empty: [],
  singleton: [atPixel("single", 1)],
};

describe("最適化前のクラスタとの一致", () => {
  for (const [name, input] of Object.entries(datasets)) {
    for (const zoom of [5, 10, 14, 19]) {
      it(`${name} zoom=${zoom} は所属・順序・中心とkeepIdが一致する`, () => {
        const before = structuredClone(input);
        for (const keepId of [
          undefined,
          input[0]?.id,
          input[Math.floor(input.length / 2)]?.id,
          "missing",
        ]) {
          // 中心も丸めずに完全一致。合計の加算順が変わる丸め誤差を許さない。
          expect(clusterShops(input, zoom, keepId)).toEqual(reference(input, zoom, keepId));
        }
        expect(input).toEqual(before);
      });
    }
  }
});
