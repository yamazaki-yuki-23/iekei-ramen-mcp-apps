/** tool の outputSchema。UI にはこの形で structuredContent が届く。 */
import { z } from "zod";

const TasteSchema = z.enum(["rich", "creamy", "chain", "unknown"]);

const ShopSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameEn: z.string().optional(),
  brand: z.string().optional(),
  taste: TasteSchema,
  confidence: z.enum(["confirmed", "likely"]),
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
  mode: z.enum(["form", "nearby", "map"]),
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
        source: z.enum(["precise", "host", "place"]),
      })
      .optional(),
  }),
  /** 選択肢を UI に渡す（都道府県リストはデータ由来なのでサーバーが持つ）。 */
  prefectures: z.array(z.string()),
});
