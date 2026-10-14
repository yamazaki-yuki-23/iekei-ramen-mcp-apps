import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AppPayload } from "../../src/types";
import { originLabel } from "../../src/utils/geo.ts";
import { TASTES } from "../../src/utils/labels";
import { describeBasis, describeScope, shortlist } from "../../src/utils/shortlist.ts";
import { conditionFields, PayloadSchema } from "../lib/schema.ts";
import type { ToolContext } from "../types/tool-context.ts";
import { decidePrompt } from "../utils/summaries.ts";
import {
  blankToUndefined,
  filterShops,
  incompleteCoordinates,
  originFrom,
} from "../utils/tool-args.ts";
import { toolMetadata } from "../utils/tool-metadata.ts";

/** 迷ったら。3 軒まで絞り、モデルに 1 軒を理由つきで推させる。 */
export function registerDecideIekeiRamen({
  server,
  dataset,
  locateCaller,
  withVisitor,
}: ToolContext): void {
  registerAppTool(
    server,
    "decide-iekei-ramen",
    {
      title: "家系ラーメンを 3 軒まで絞る",
      description:
        "条件に合う家系ラーメン店を 3 軒まで絞り込み、その中から 1 軒を理由つきで推すための UI を表示する。一覧を見せても決められないとき、または「どこにする？」「おすすめは？」と聞かれたときに使う。round を 1 つ増やすと次の 3 軒に入れ替わる。",
      inputSchema: z.object({
        ...conditionFields,
        lat: z
          .number()
          .min(-90)
          .max(90)
          .optional()
          .describe("利用者が地名や地図で指定した地点の緯度。あれば近い順に絞る"),
        lon: z
          .number()
          .min(-180)
          .max(180)
          .optional()
          .describe("利用者が地名や地図で指定した地点の経度"),
        label: z.string().optional().describe("基準地点の表示名（例: 横浜駅）"),
        near: z
          .union([z.boolean(), z.literal("auto")])
          .optional()
          .describe(
            "true なら、lat / lon が無いときにホストが渡す位置・接続元からの推定位置を基準地点にして" +
              "近い順に絞る（利用者の現在地の近く）。どれも取れなければ 0 軒で返す。" +
              "auto は、取れれば近く・取れなければ全国から（Web の最初の画面用）",
          ),
        source: z
          .enum(["precise", "host", "edge", "place"])
          .optional()
          .describe(
            "緯度経度の出どころ。省略すると place（地名から解決）扱い。" +
              "現在地モードから引き継ぐときは、その精度をそのまま渡すこと",
          ),
        round: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("何巡目か（0 始まり）。増やすと次の 3 軒。末尾まで行くと先頭へ戻る"),
      }),
      outputSchema: PayloadSchema,
      ...toolMetadata("decide-iekei-ramen"),
    },
    async (
      { prefecture, taste, keyword, lat, lon, label, near, source, round },
      ctx,
    ): Promise<CallToolResult> => {
      const incomplete = incompleteCoordinates(lat, lon);
      if (incomplete) return incomplete;

      /*
       * 出どころは受け取ったものをそのまま持つ。ここで place に固定すると、
       * 端末の位置情報から来た座標まで「指定した地名」に化け、現在地モードへ
       * 戻ったときに誤った精度が表示される。
       *
       * near のときは、座標が無ければ find-nearby と同じ順で現在地を探す（#147）。
       * ブラウザの位置が取れないホスト（ChatGPT）でも、券売機の「近くで」が条件ごと
       * 3 軒を出せるように。
       */
      const origin =
        originFrom({ lat, lon, label, source }, "place") ??
        (near ? await locateCaller(ctx.mcpReq._meta, ctx.http?.req) : undefined);
      // auto は「分かれば近く」。分からなければ案内せずに全国から並べる（#152）。
      /*
       * 効かないキーワードを持ち回らない。filterShops は trim 後に空なら
       * 絞り込まないのに、生の値を payload と説明文に残すと、UI には外せる
       * チップが出て、モデルには「この語に合う 558 軒」と伝わる。
       */
      const kw = blankToUndefined(keyword);
      if (near === true && !origin) {
        // 現在地なしで全国から並べると「近く」を頼んだのに遠い店が出る。0 軒で返し、
        // UI は都道府県・地図・地名へ案内する（条件は消さない）。
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
          structuredContent: await withVisitor({
            mode: "decide",
            shops: [],
            total: 0,
            query: { prefecture, taste, keyword: kw },
            decide: {
              round: 0,
              rounds: 1,
              poolTotal: 0,
              basis: "distance",
              widened: false,
              needsOrigin: true,
            },
          }),
        };
      }
      const list = shortlist(filterShops(dataset, { prefecture, taste, keyword: kw }), {
        origin,
        round,
      });
      /*
       * 基準地点があるなら必ず名乗る。label を省いて呼ばれたときに落とすと、
       * 距離で並べた結果なのに「全国」と書くことになる。
       */
      const cond =
        [prefecture, taste && TASTES[taste].label, kw, origin && originLabel(origin)]
          .filter(Boolean)
          .join(" / ") || "全国";
      const payload: Omit<AppPayload, "prefectures"> = {
        mode: "decide",
        shops: list.picks,
        total: list.poolTotal,
        query: { prefecture, taste, keyword: kw, origin },
        decide: {
          round: list.round,
          rounds: list.rounds,
          poolTotal: list.poolTotal,
          basis: list.basis,
          widened: list.widened,
          includesLikely: list.includesLikely,
        },
      };
      return {
        content: [
          {
            type: "text",
            text: decidePrompt(
              list.picks,
              `${describeScope(list)}${describeBasis(list, list.picks.length, origin, kw)}`,
              cond,
              list,
            ),
          },
        ],
        structuredContent: await withVisitor(payload),
      };
    },
  );
}
