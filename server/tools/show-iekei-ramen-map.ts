import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AppPayload } from "../../src/types";
import { ALL_PREFECTURES } from "../../src/utils/prefectures.ts";
import { BoundsSchema, PayloadSchema } from "../lib/schema.ts";
import type { ToolContext } from "../types/tool-context.ts";
import { mapSummary } from "../utils/summaries.ts";
import { filterShops, originFrom } from "../utils/tool-args.ts";
import { toolMetadata } from "../utils/tool-metadata.ts";

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
    async ({ prefecture, taste, bounds, lat, lon, label, source }): Promise<CallToolResult> => {
      const shops = filterShops(dataset, { prefecture, taste, bounds });
      // 座標が片方だけ来たときは基準地点として扱わない（地図に嘘の印が出る）。
      const origin = originFrom({ lat, lon, label, source }, "precise");
      const payload: Omit<AppPayload, "prefectures"> = {
        mode: "map",
        shops,
        total: shops.length,
        query: { prefecture, taste, bounds, origin },
      };
      return {
        content: [
          {
            type: "text",
            text: mapSummary(shops, prefecture, bounds),
          },
        ],
        structuredContent: await withVisitor(payload),
      };
    },
  );
}
