import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { StampResultSchema } from "../lib/schema.ts";
import type { ToolContext } from "../types/tool-context.ts";
import { toolMetadata } from "../utils/tool-metadata.ts";

/**
 * 行った店に印を付ける・外す（サインインが要る）。
 *
 * **worker 側でトークンを確かめてから**呼ばれる。匿名のまま来た場合は tool に届く前に
 * 401 を返している（MEMBER_TOOLS）。それでも念のため確かめるのは、呼び出し口が増えたときに
 * 黙って通らないため。
 */
export function registerStampIekeiRamen({
  server,
  dataset,
  prefectures,
  brands,
  requireVisitor,
  visitorExtras,
}: ToolContext): void {
  registerAppTool(
    server,
    "stamp-iekei-ramen",
    {
      title: "行った店に印を付ける",
      description: "訪問した家系ラーメン店に印を付ける、または外す。サインインした人だけが使える。",
      inputSchema: z.object({
        shopId: z.string().describe("店舗 ID"),
        visited: z.boolean().default(true).describe("true で付ける、false で外す"),
        includeShops: z
          .boolean()
          .default(true)
          .describe("通常はtrue。検索・地図UIが訪問IDと制覇率だけを更新するときはfalse"),
      }),
      outputSchema: StampResultSchema,
      ...toolMetadata("stamp-iekei-ramen"),
    },
    async ({ shopId, visited, includeShops }): Promise<CallToolResult> => {
      const { visitor, visits } = requireVisitor();
      const shop = dataset.find((s) => s.id === shopId);
      // 知らない店 ID は記録しない。消えた店のゴミが溜まるため。
      if (!shop) {
        return {
          content: [{ type: "text", text: `店舗 ${shopId} が見つかりませんでした。` }],
          isError: true,
        };
      }

      await visits.set(visitor.id, shopId, visited);
      const extras = await visitorExtras();
      const progress = extras.progress!;
      const snapshot = { visited: extras.visited!, progress };
      // 軽量経路では一覧の抽出とJSON化も省く。同じ読み取りから両形式を組む。
      let structuredContent: Record<string, unknown> = snapshot;
      if (includeShops) {
        const visitedIds = new Set(snapshot.visited);
        structuredContent = {
          mode: "visited",
          shops: dataset.filter((s) => visitedIds.has(s.id)),
          total: progress.overall.visited,
          query: {},
          prefectures,
          brands,
          ...snapshot,
        };
      }
      return {
        content: [
          {
            type: "text",
            text:
              `${shop.name}を${visited ? "訪問済みにしました" : "未訪問に戻しました"}。` +
              `全国 ${progress.overall.total} 軒のうち ${progress.overall.visited} 軒` +
              `（${progress.overall.percent}%）です。`,
          },
        ],
        structuredContent,
      };
    },
  );
}
