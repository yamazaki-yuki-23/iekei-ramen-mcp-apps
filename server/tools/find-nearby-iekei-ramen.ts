import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AppPayload, Origin } from "../../src/types";
import { distanceKm, originLabel } from "../../src/utils/geo.ts";
import { ORIGIN_NOTES } from "../../src/utils/labels";
import { shopFacts } from "../../src/utils/shop-facts.ts";
import { PayloadSchema } from "../lib/schema.ts";
import type { ToolContext } from "../types/tool-context.ts";
import { summarize } from "../utils/summaries.ts";
import { incompleteCoordinates, originFrom } from "../utils/tool-args.ts";
import { toolMetadata } from "../utils/tool-metadata.ts";

/** 現在地から探す。近い順に提案する。 */
export function registerFindNearbyIekeiRamen({
  server,
  dataset,
  brandsInCity,
  locateCaller,
  withVisitor,
}: ToolContext): void {
  registerAppTool(
    server,
    "find-nearby-iekei-ramen",
    {
      title: "近くの家系ラーメンを探す",
      description:
        "現在地から近い順に家系ラーメン店を提案する（既定 5 件）。緯度経度を省略すると、ホストが渡す大まかな現在地を使う。特定の地名から探したい場合は先に geocode-place で座標を調べる。",
      inputSchema: z.object({
        lat: z
          .number()
          .min(-90)
          .max(90)
          .optional()
          .describe("利用者が地名や地図で指定した地点の緯度。省略するとホストの現在地を使う"),
        lon: z
          .number()
          .min(-180)
          .max(180)
          .optional()
          .describe("利用者が地名や地図で指定した地点の経度。省略するとホストの現在地を使う"),
        limit: z.number().int().min(1).max(20).default(5).describe("提案する店舗数"),
        offset: z
          .number()
          .int()
          .min(0)
          .max(1000)
          .default(0)
          .describe("近い順の何件目から返すか（0 始まり）。続きを取るときに使う"),
        facts: z
          .boolean()
          .optional()
          .describe(
            "true なら、各店に事実だけの特徴（直系・濃厚、朝 5 時から、その市区町村で 1 軒だけのブランド）を添える",
          ),
        label: z.string().optional().describe("基準地点の表示名（例: 横浜駅）"),
        /*
         * OriginSource の 4 値すべてを受ける。2 値に絞っていた頃は、ホスト由来
         * （host）や接続元推定（edge）の座標を持って「迷ったら」から戻ると、
         * 検証エラーで現在地モードが開けなくなっていた。
         */
        source: z
          .enum(["precise", "host", "edge", "place"])
          .optional()
          .describe(
            "緯度経度の出どころ: precise=端末の位置情報 / host=ホストが渡す大まかな位置 / " +
              "edge=接続元からの推定 / place=地名から解決。省略すると precise 扱い",
          ),
      }),
      outputSchema: PayloadSchema,
      ...toolMetadata("find-nearby-iekei-ramen"),
    },
    async ({ lat, lon, limit, offset, facts, label, source }, ctx): Promise<CallToolResult> => {
      const incomplete = incompleteCoordinates(lat, lon);
      if (incomplete) return incomplete;

      // 精度の高い順に降りていく。引数 → ホストが渡す位置 → 接続元からの推定。
      // 最後のものは HTTP なら request.cf から、stdio なら照会エンドポイントから取る。
      const origin: Origin | undefined =
        originFrom({ lat, lon, label, source }, "precise") ??
        (await locateCaller(ctx.mcpReq._meta, ctx.http?.req));

      if (!origin) {
        // ホストが位置情報を渡さない環境。UI は地名入力へ誘導する。
        return {
          content: [
            {
              type: "text",
              text:
                "現在地を特定できませんでした。" +
                "ユーザーに地名や駅名を尋ね、geocode-place で座標に変換してから" +
                "lat / lon を指定して呼び直してください。",
            },
          ],
          // **ここも withVisitor を通す。** 通さないと visited が落ち、
          // サインインしている人が UI から匿名に見える（記録の釦がサインインの
          // 依頼に変わる）。payload の出口はここも含めて 1 つにする。
          structuredContent: await withVisitor({
            mode: "nearby",
            shops: [],
            total: 0,
            query: {},
          }),
        };
      }

      const ranked = dataset
        .map((s) => ({
          ...s,
          distanceKm: Number(distanceKm(origin.lat, origin.lon, s.lat, s.lon).toFixed(3)),
        }))
        .toSorted((a, b) => a.distanceKm - b.distanceKm)
        .slice(offset, offset + limit)
        // 家系マッチのレア札の理由（#166）。事実だけ。頼まれたときだけ添える。
        .map((s) => (facts ? { ...s, facts: shopFacts(s, brandsInCity) } : s));
      const payload: Omit<AppPayload, "prefectures"> = {
        mode: "nearby",
        shops: ranked,
        total: ranked.length,
        query: { origin },
      };
      const where = originLabel(origin);
      const note = origin.source === "precise" ? "" : `（${ORIGIN_NOTES[origin.source]}）`;
      return {
        content: [
          {
            type: "text",
            text: summarize(
              ranked,
              `${where}${note} から近い家系ラーメン ${ranked.length} 件`,
              true,
            ),
          },
        ],
        structuredContent: await withVisitor(payload),
      };
    },
  );
}
