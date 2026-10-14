import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AppPayload } from "../../src/types";
import { RECORDS_WITHOUT_SHOPS } from "../../src/utils/visited-view.ts";
import { PayloadSchema } from "../lib/schema.ts";
import type { ToolContext } from "../types/tool-context.ts";
import { toolMetadata } from "../utils/tool-metadata.ts";

/** 行った店と制覇率を見る（サインインが要る）。 */
export function registerShowVisitedIekeiRamen({
  server,
  dataset,
  requireVisitor,
  visitorExtras,
  withVisitor,
}: ToolContext): void {
  registerAppTool(
    server,
    "show-visited-iekei-ramen",
    {
      title: "行った店と制覇率を見る",
      description:
        "訪問済みの家系ラーメン店の一覧と、県ごと・全国の制覇率を表示する。サインインした人だけが使える。",
      inputSchema: z.object({}),
      outputSchema: PayloadSchema,
      ...toolMetadata("show-visited-iekei-ramen"),
    },
    async (): Promise<CallToolResult> => {
      requireVisitor();
      const extras = await visitorExtras();
      const progress = extras.progress!;
      const visitedIds = new Set(extras.visited);
      const shops = dataset.filter((s) => visitedIds.has(s.id));
      const payload: Omit<AppPayload, "prefectures"> = {
        mode: "visited",
        shops,
        total: shops.length,
        query: {},
      };
      const top = progress.prefectures
        .slice(0, 5)
        .map((p) => `${p.prefecture} ${p.visited}/${p.total}`)
        .join(" / ");
      /*
       * **「1 軒も記録がない」は、記録の件数で決める。**
       *
       * 一覧が空でも、記録が残っていることがある（データを取り直して店が
       * 消えた場合）。並んでいる店の数で決めると、記録があるのにモデルへ
       * 「まだ 1 軒も記録がありません」と伝え、構造化データと食い違う。
       * 画面と同じ文を渡す（UI は visited-view.ts で同じ判断をしている）。
       */
      const recorded = extras.visited!.length;
      return {
        content: [
          {
            type: "text",
            text:
              recorded === 0
                ? "まだ 1 軒も記録がありません。"
                : shops.length === 0
                  ? RECORDS_WITHOUT_SHOPS
                  : `${progress.overall.visited} 軒（全国 ${progress.overall.total} 軒中 ` +
                    `${progress.overall.percent}%）。${top}`,
          },
        ],
        structuredContent: await withVisitor(payload, extras),
      };
    },
  );
}
