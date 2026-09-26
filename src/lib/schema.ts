/** tool の outputSchema。UI にはこの形で structuredContent が届く。 */
import { z } from "zod";

const TasteSchema = z.enum(["rich", "creamy", "chain", "unknown"]);

/**
 * 地図に出ている範囲。
 *
 * **緯度経度の妥当性はここで弾く。** 地図から渡ってくる値は、引ききった
 * ときに ±180 を超えることがある（Leaflet は世界を繰り返して数える）。
 */
export const BoundsSchema = z
  .object({
    north: z.number().min(-90).max(90),
    south: z.number().min(-90).max(90),
    east: z.number().min(-180).max(180),
    west: z.number().min(-180).max(180),
  })
  /*
   * **角の順番も見る。** 1 つずつの範囲だけ見ていると、南北が逆でも通る。
   * そのまま絞り込むと、成り立たない比較になって必ず 0 件になり、
   * 呼び出し側の間違いが「この範囲に店はありません」という答えに化ける
   * （実測: isError は付かず、「該当する店舗はありませんでした」が返っていた）。
   * 日付変更線はまたがない（国内だけのデータ）ので、経度も南西 → 北東で見る。
   */
  .refine((b) => b.south <= b.north && b.west <= b.east, {
    message: "範囲は南西と北東の角で渡してください（south ≤ north、west ≤ east）",
  });

const ShopSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameEn: z.string().optional(),
  brand: z.string().optional(),
  taste: TasteSchema,
  confidence: z.enum(["confirmed", "likely", "candidate"]),
  prefecture: z.string(),
  city: z.string().optional(),
  address: z.string().optional(),
  lat: z.number(),
  lon: z.number(),
  openingHours: z.string().optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  osmUrl: z.string(),
  /** 「近くを探す」のときだけ入る、現在地からの直線距離 (km)。 */
  distanceKm: z.number().optional(),
});

export const PayloadSchema = z.object({
  mode: z.enum(["form", "nearby", "map", "decide"]),
  shops: z.array(ShopSchema),
  total: z.number(),
  query: z.object({
    prefecture: z.string().optional(),
    taste: TasteSchema.optional(),
    keyword: z.string().optional(),
    origin: z
      .object({
        lat: z.number(),
        lon: z.number(),
        label: z.string().optional(),
        source: z.enum(["precise", "host", "edge", "place"]),
      })
      .optional(),
    bounds: BoundsSchema.optional(),
  }),
  /** 選択肢を UI に渡す（都道府県リストはデータ由来なのでサーバーが持つ）。 */
  prefectures: z.array(z.string()),
  /** 「迷ったら」のときだけ入る、3 軒をどう選んだかの内訳。 */
  decide: z
    .object({
      round: z.number(),
      rounds: z.number(),
      poolTotal: z.number(),
      basis: z.enum(["distance", "hours"]),
      widened: z.boolean(),
    })
    .optional(),
});
