/** tool の outputSchema。UI にはこの形で structuredContent が届く。 */
import { z } from "zod";

const TasteSchema = z.enum(["rich", "creamy", "chain", "unknown"]);

/**
 * 地図に出ている範囲。
 *
 * **緯度経度の妥当性はここで弾く。** 地図から渡ってくる値は、引ききった
 * ときに ±180 を超えることがある（Leaflet は世界を繰り返して数える）。
 */
export const BoundsSchema = z.object({
  north: z.number().min(-90).max(90),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  west: z.number().min(-180).max(180),
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
