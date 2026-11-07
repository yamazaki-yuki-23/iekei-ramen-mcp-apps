import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AppPayload, Bounds } from "../../src/types";
import { ALL_PREFECTURES } from "../../src/utils/prefectures.ts";
import { BoundsSchema, PayloadSchema } from "../lib/schema.ts";
import type { ToolContext } from "../types/tool-context.ts";
import { mapSummary } from "../utils/summaries.ts";
import { filterShops, originFrom } from "../utils/tool-args.ts";
import { toolMetadata } from "../utils/tool-metadata.ts";

/** 店がすべて入る範囲。端の店がピンごと切れないよう、少し広げる。 */
function spanOf(shops: Array<{ lat: number; lon: number }>): Bounds | undefined {
  if (shops.length === 0) return undefined;
  const lats = shops.map((s) => s.lat);
  const lons = shops.map((s) => s.lon);
  const pad = 0.01;
  return {
    north: Math.max(...lats) + pad,
    south: Math.min(...lats) - pad,
    east: Math.max(...lons) + pad,
    west: Math.min(...lons) - pad,
  };
}

/** 地図から探す。日本地図に店を出す。 */
export function registerShowIekeiRamenMap({ server, dataset, withVisitor }: ToolContext): void {
  registerAppTool(
    server,
    "show-iekei-ramen-map",
    {
      title: "家系ラーメンを地図で見る",
      description:
        "全国の家系ラーメン店を日本地図上にプロットして表示する。都道府県や味で絞り込んだ状態で開くこともできる。",
      inputSchema: z.object({
        prefecture: z.enum(ALL_PREFECTURES).optional().describe("この都道府県にズームして表示する"),
        taste: z.enum(["rich", "creamy", "chain"]).optional().describe("味の傾向で絞り込む"),
        bounds: BoundsSchema.optional().describe(
          "地図に出ている範囲で絞り込む。UI の「この範囲で探す」から渡る",
        ),
        keyword: z
          .string()
          .max(100)
          .optional()
          .describe(
            "地名（市区町村）の部分一致。合う店がすべて入る範囲で開き、その範囲の店を出す" +
              "（市区町村のページの「〇〇の地図を開く」用）。合う店が無ければ都道府県で開く",
          ),
        /*
         * 基準地点は絞り込みではなく、地図に印と同心円を出すためのもの。
         * 現在地モードから地図へ移ったときに引き継ぐ。
         */
        lat: z
          .number()
          .min(-90)
          .max(90)
          .optional()
          .describe("利用者が地名や地図で指定した地点の緯度（印と同心円を出す）"),
        lon: z
          .number()
          .min(-180)
          .max(180)
          .optional()
          .describe("利用者が地名や地図で指定した地点の経度"),
        label: z.string().optional().describe("基準地点の表示名（例: 横浜駅）"),
        source: z
          .enum(["precise", "host", "edge", "place"])
          .optional()
          .describe("緯度経度の出どころ。省略すると precise 扱い"),
      }),
      outputSchema: PayloadSchema,
      ...toolMetadata("show-iekei-ramen-map"),
    },
    async ({
      prefecture,
      taste,
      bounds: asked,
      keyword,
      lat,
      lon,
      label,
      source,
    }): Promise<CallToolResult> => {
      /*
       * 地名で開くとき（#368）は、合う店が入る範囲に置き換える。**座標は URL から受け取らない**
       * （web-entry の決まり）ので、範囲はここで店から作る。その範囲の店を全部出すのは、
       * 市の境で隣の店が消えると地図として嘘になるため。見出しは「この範囲」になる。
       */
      const area =
        !asked && keyword?.trim()
          ? spanOf(filterShops(dataset, { prefecture, keyword }))
          : undefined;
      const bounds = asked ?? area;
      // 範囲に置き換えたら、県では絞らない（県境の近くの市で、隣の県の店が地図から消える）。
      const pref = area ? undefined : prefecture;
      const shops = filterShops(dataset, { prefecture: pref, taste, bounds });
      // 座標が片方だけ来たときは基準地点として扱わない（地図に嘘の印が出る）。
      const origin = originFrom({ lat, lon, label, source }, "precise");
      const payload: Omit<AppPayload, "prefectures"> = {
        mode: "map",
        shops,
        total: shops.length,
        query: { prefecture: pref, taste, bounds, origin },
      };
      return {
        content: [
          {
            type: "text",
            text: mapSummary(shops, pref, bounds),
          },
        ],
        structuredContent: await withVisitor(payload),
      };
    },
  );
}
