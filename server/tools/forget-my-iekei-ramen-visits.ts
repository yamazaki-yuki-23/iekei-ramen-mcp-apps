import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AppPayload } from "../../src/types";
import { summarize as summarizeVisits } from "../../src/utils/progress.ts";
import { PayloadSchema } from "../lib/schema.ts";
import type { ToolContext } from "../types/tool-context.ts";
import { toolMetadata } from "../utils/tool-metadata.ts";

/** 記録を全部消す（サインインが要る）。元に戻せない。 */
export function registerForgetMyIekeiRamenVisits({
  server,
  dataset,
  requireVisitor,
  withVisitor,
}: ToolContext): void {
  registerAppTool(
    server,
    "forget-my-iekei-ramen-visits",
    {
      title: "記録を全部消す",
      description: "その人の訪問記録をすべて削除する。元に戻せない。",
      inputSchema: z.object({}),
      outputSchema: PayloadSchema,
      ...toolMetadata("forget-my-iekei-ramen-visits"),
    },
    async (): Promise<CallToolResult> => {
      const { visitor, visits } = requireVisitor();
      await visits.clear(visitor.id);
      const payload: Omit<AppPayload, "prefectures"> = {
        mode: "visited",
        shops: [],
        total: 0,
        query: {},
      };
      return {
        content: [{ type: "text", text: "訪問記録をすべて削除しました。" }],
        // 消した直後の写しをその場で作る。読み直すと、その間に別のホストから
        // 押された 1 件を拾い、「全部消した」と言いながら 1 軒残った応答になる。
        structuredContent: await withVisitor(payload, {
          visited: [],
          progress: summarizeVisits(dataset, []),
        }),
      };
    },
  );
}
