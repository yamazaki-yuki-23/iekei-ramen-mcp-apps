import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { GEOCODE_MAX_WAIT_MS } from "./geocode-gate.ts";
import { GEOCODE_RESPONSE_TIMEOUT_MS } from "./geocode-timeout.ts";
import type { ServerDeps } from "../types/deps.ts";

/** Nominatim の利用ポリシーが求める「アプリと連絡先が分かる」名乗り。 */
export const NOMINATIM_USER_AGENT =
  "iekei-ramen-mcp-apps/0.1 (+https://github.com/yamazaki-yuki-23/iekei-ramen-mcp-apps)";

/** 地名は変わらないので長めに持つ。ポリシーの例も 7 日単位。 */
export const GEOCODE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Gate の送信枠待ち最大 3 秒と、外部応答・本文の最大 10 秒を合わせる。 */
export const GEOCODE_GATE_CALL_TIMEOUT_MS = GEOCODE_MAX_WAIT_MS + GEOCODE_RESPONSE_TIMEOUT_MS;

export const geocodeTimeoutResult = (): CallToolResult => ({
  content: [
    {
      type: "text",
      text: "地名の検索に時間がかかったため中止しました。もう一度お試しください。",
    },
  ],
  isError: true,
});

type GeocodeHit = { label: string; lat: number; lon: number };

const GeocodeCacheSchema = z.array(
  z.object({
    label: z.string(),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
);

/** KV の障害・壊れた値は未保存として扱い、通常の制限付き検索へ戻す。 */
export async function readGeocodeCache(
  cache: ServerDeps["geocodeCache"],
  key: string,
): Promise<GeocodeHit[] | null> {
  try {
    const cached = await cache?.get(key);
    if (!cached) return null;
    const parsed = GeocodeCacheSchema.safeParse(JSON.parse(cached));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * 表記の揺れを畳んだ問い合わせ文。**キャッシュの鍵と送る文を同じにする。**
 * 全角の英数や空白を半角に寄せないと、同じ地名が別の鍵になる。
 */
export function normalizePlaceQuery(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/**
 * キャッシュの鍵。**問い合わせ文をそのまま鍵にしない。** KV の鍵は 512 バイトまでで、
 * 和文は 1 字 3 バイトなので 170 字ほどの住所で超え、KV が例外を投げる
 * （貼り付けた住所や、モデルが直接呼んだときに起きる）。長さの揃うハッシュにする。
 */
export async function geocodeCacheKey(q: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(q));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `geocode:${hex}`;
}
