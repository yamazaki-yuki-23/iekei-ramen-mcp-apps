import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AppPayload } from "../../src/types";
import { TASTES } from "../../src/utils/labels";
import { conditionFields, PayloadSchema } from "../lib/schema.ts";
import type { ToolContext } from "../types/tool-context.ts";
import { summarize } from "../utils/summaries.ts";
import { blankToUndefined, filterShops } from "../utils/tool-args.ts";
import { toolMetadata } from "../utils/tool-metadata.ts";

/** 検索フォーム。都道府県・味の傾向・キーワードで絞り込む。 */
export function registerSearchIekeiRamen({ server, dataset, withVisitor }: ToolContext): void {
  registerAppTool(
    server,
    "search-iekei-ramen",
    {
      title: "家系ラーメンを検索",
      description:
        "都道府県・味の傾向・キーワードで全国の家系ラーメン店を絞り込み、検索フォーム付きの一覧 UI を表示する。条件を指定しなければ全国の一覧を返す。",
      inputSchema: z.object(conditionFields),
      outputSchema: PayloadSchema,
      ...toolMetadata("search-iekei-ramen"),
    },
    async ({ prefecture, taste, keyword }): Promise<CallToolResult> => {
      const kw = blankToUndefined(keyword);
      const all = filterShops(dataset, { prefecture, taste, keyword: kw });
      const shops = all.slice(0, 200);
      const cond =
        [prefecture, taste && TASTES[taste].label, kw].filter(Boolean).join(" / ") || "全国";
      const payload: Omit<AppPayload, "prefectures"> = {
        mode: "form",
        shops,
        total: all.length,
        query: { prefecture, taste, keyword: kw },
      };
      return {
        content: [
          {
            type: "text",
            text: summarize(shops.slice(0, 10), `【${cond}】${all.length} 件ヒット（上位 10 件）`),
          },
        ],
        structuredContent: await withVisitor(payload),
      };
    },
  );
}
