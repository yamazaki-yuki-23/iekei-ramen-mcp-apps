import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  GEOCODE_GATE_CALL_TIMEOUT_MS,
  GEOCODE_TTL_SECONDS,
  geocodeCacheKey,
  geocodeTimeoutResult,
  NOMINATIM_USER_AGENT,
  normalizePlaceQuery,
  readGeocodeCache,
} from "../lib/geocode.ts";
import {
  GEOCODE_RESPONSE_TIMEOUT_MS,
  GeocodeTimeoutError,
  withGeocodeTimeout,
} from "../lib/geocode-timeout.ts";
import type { ToolContext } from "../types/tool-context.ts";
import { toolMetadata } from "../utils/tool-metadata.ts";

/** 補助: 地名 → 緯度経度。UI から呼ぶ（UI は持たない）。 */
export function registerGeocodePlace({ server, deps }: ToolContext): void {
  server.registerTool(
    "geocode-place",
    {
      ...toolMetadata("geocode-place", false),
      title: "地名から緯度経度を調べる",
      description:
        "地名や住所を OpenStreetMap Nominatim で緯度経度に変換する。find-nearby-iekei-ramen の前段として使う。",
      inputSchema: z.object({ query: z.string().describe("地名・駅名・住所") }),
    },
    async ({ query }): Promise<CallToolResult> => {
      const q = normalizePlaceQuery(query);
      const key = await geocodeCacheKey(q);
      let hits = await readGeocodeCache(deps.geocodeCache, key);
      if (hits === null) {
        // 止めるのは Nominatim へ出ていくときだけ。キャッシュで答えられる分は数えない。
        if (deps.allowGeocode && !(await deps.allowGeocode())) {
          return {
            content: [
              {
                type: "text",
                text: "地名の検索が続いたため、少し止めています。1 分ほど待ってからもう一度お試しください。",
              },
            ],
            isError: true,
          };
        }
        const params = new URLSearchParams({
          q,
          format: "json",
          limit: "3",
          "accept-language": "ja",
        });
        let res: {
          ok: boolean;
          status: number;
          results: Array<{ display_name: string; lat: string; lon: string }>;
        };
        try {
          res = await withGeocodeTimeout(
            async (signal) => {
              const response = await (deps.nominatim ?? fetch)(
                `https://nominatim.openstreetmap.org/search?${params}`,
                { headers: { "User-Agent": NOMINATIM_USER_AGENT }, signal },
              );
              return {
                ok: response.ok,
                status: response.status,
                results: response.ok ? await response.json() : [],
              };
            },
            deps.nominatim ? GEOCODE_GATE_CALL_TIMEOUT_MS : GEOCODE_RESPONSE_TIMEOUT_MS,
          );
        } catch (error) {
          if (error instanceof GeocodeTimeoutError) return geocodeTimeoutResult();
          throw error;
        }
        if (!res.ok) {
          if (res.status === 504) return geocodeTimeoutResult();
          return {
            content: [
              {
                type: "text",
                text:
                  res.status === 429
                    ? "地名の検索が混み合っています。少し待ってからもう一度お試しください。"
                    : `地名の検索に失敗しました（${res.status}）。少し待ってからもう一度お試しください。`,
              },
            ],
            isError: true,
          };
        }
        const results = res.results;
        hits = results.map((r) => ({
          label: r.display_name,
          lat: Number(r.lat),
          lon: Number(r.lon),
        }));
        // 見つからなかったことも持つ。打ち間違いの連打も Nominatim へ流さない。
        try {
          await deps.geocodeCache?.put(key, JSON.stringify(hits), {
            expirationTtl: GEOCODE_TTL_SECONDS,
          });
        } catch {
          // 保存が失敗しても取得済みの結果を返す。内部例外や問い合わせ文はログに出さない。
        }
      }
      if (hits.length === 0) {
        return {
          content: [{ type: "text", text: `「${query}」は見つかりませんでした。` }],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: hits.map((r) => `${r.label}\n  lat=${r.lat}, lon=${r.lon}`).join("\n\n"),
          },
        ],
        structuredContent: { results: hits },
      };
    },
  );
}
