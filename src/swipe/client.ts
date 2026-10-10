import type { Client } from "@modelcontextprotocol/client";
import { requestBrowserPosition } from "../lib/browser-position";
import { readPayload } from "../lib/payload";
import { SWIPE_STEP } from "../lib/swipe";
import type { Origin, Shop } from "../lib/types";

/** 同じ origin の /mcp を呼ぶ（検索の決まりはサーバーの tool だけが持つ）。 */
async function connect(): Promise<Client> {
  const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");
  const client = new Client({ name: "Iekei Ramen Swipe", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", window.location.href)));
  return client;
}

export interface Page {
  shops: Shop[];
  origin?: Origin;
}

async function nearby(client: Client, offset: number, origin?: Origin): Promise<Page> {
  const result = await client.callTool({
    name: "find-nearby-iekei-ramen",
    arguments: {
      limit: SWIPE_STEP,
      offset,
      facts: true,
      ...(origin
        ? { lat: origin.lat, lon: origin.lon, label: origin.label, source: origin.source }
        : {}),
    },
  });
  const payload = readPayload(result);
  if (result.isError || !payload) throw new Error("近くの家系を読み込めませんでした。");
  return { shops: payload.shops, origin: payload.query.origin };
}

/**
 * 近くの家系を近い順に、SWIPE_STEP 軒ずつ取る。
 *
 * 最初の範囲は**接続元から推定した地域**（#152 の仕組み。位置の許可は求めない）。推定できない
 * ときだけ、ブラウザの位置を 1 度試す。それも取れなければ origin 無しで返し、画面が地名の入力へ案内する。
 * 続き（offset）は、最初に決まった基準地点で取る（途中で場所が変わらないように）。
 */
export function createFeed() {
  const ready = connect();
  let origin: Origin | undefined;
  return {
    async first(): Promise<Page> {
      const client = await ready;
      const page = await nearby(client, 0);
      if (page.origin) {
        origin = page.origin;
        return page;
      }
      const pos = await requestBrowserPosition();
      if (!pos) return { shops: [] };
      origin = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        label: "現在地",
        source: "precise",
      };
      return nearby(client, 0, origin);
    },
    /**
     * 地名・駅名から探す（接続元もブラウザの位置も取れなかったとき）。見つからなければ null。
     * 失敗（連打止め・地名検索の不調）は「見つからない」にせず、理由ごと投げる。
     */
    async fromPlace(query: string): Promise<Page | null> {
      const client = await ready;
      const result = await client.callTool({ name: "geocode-place", arguments: { query } });
      if (result.isError) {
        const text = (result.content as Array<{ type: string; text?: string }>).find(
          (c) => c.type === "text",
        )?.text;
        throw new Error(text ?? "地名の検索に失敗しました。");
      }
      const hit = (
        result.structuredContent as
          | { results?: Array<{ label: string; lat: number; lon: number }> }
          | undefined
      )?.results?.[0];
      if (!hit) return null;
      origin = {
        lat: hit.lat,
        lon: hit.lon,
        label: hit.label.split(",")[0].trim(),
        source: "place",
      };
      return nearby(client, 0, origin);
    },
    async next(offset: number): Promise<Page> {
      return nearby(await ready, offset, origin);
    },
  };
}
