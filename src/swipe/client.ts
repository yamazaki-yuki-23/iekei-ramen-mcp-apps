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

/** ブラウザの位置を基準地点にする。 */
const browserOrigin = (pos: GeolocationPosition): Origin => ({
  lat: pos.coords.latitude,
  lon: pos.coords.longitude,
  label: "現在地",
  source: "precise",
});

/**
 * 近くの家系を近い順に、SWIPE_STEP 軒ずつ取る。
 *
 * 最初の範囲は**接続元から推定した地域**（#152 の仕組み。位置の許可は求めない）。推定できない
 * ときだけ、ブラウザの位置を 1 度試す。それも取れなければ origin 無しで返し、画面が地名の入力へ案内する。
 * 続き（offset）は、最初に決まった基準地点で取る（途中で場所が変わらないように）。
 */
export function createFeed() {
  /*
   * 接続は、最初に店を頼んだときに始める（#203）。接続の部品（MCP クライアント、約 88KB）を開いた直後に
   * 読むと、最初の表示と回線を取り合う。家系カメラは写真を選ぶまで店を頼まないので、撮る画面では読まない。
   */
  let connection: Promise<Client> | undefined;
  const ready = () => (connection ??= connect());
  let origin: Origin | undefined;
  // 探し直しが重なったら、最後に頼んだものの場所だけを覚える（遅れて返った古い検索で上書きしない）。
  let asked = 0;
  const keep = (mine: number, next: Origin) => {
    if (mine === asked) origin = next;
  };
  const from = async (mine: number, client: Client, next: Origin) => {
    const page = await nearby(client, 0, next);
    keep(mine, next);
    return page;
  };
  return {
    /** 店を頼む前に、接続だけ始めておく（家系カメラで撮り始めたとき。#203）。失敗は頼んだときに出す。 */
    warm() {
      ready().catch(() => {});
    },
    async first(): Promise<Page> {
      const mine = ++asked;
      const client = await ready();
      const page = await nearby(client, 0);
      if (page.origin) {
        keep(mine, page.origin);
        return page;
      }
      const pos = await requestBrowserPosition();
      if (!pos) return { shops: [] };
      return from(mine, client, browserOrigin(pos));
    },
    /**
     * 地名・駅名から探す（接続元もブラウザの位置も取れなかったとき）。見つからなければ null。
     * 失敗（連打止め・地名検索の不調）は「見つからない」にせず、理由ごと投げる。
     */
    async fromPlace(query: string): Promise<Page | null> {
      const mine = ++asked;
      const client = await ready();
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
      return from(mine, client, {
        lat: hit.lat,
        lon: hit.lon,
        label: hit.label.split(",")[0].trim(),
        source: "place",
      });
    },
    /**
     * いまの基準地点で、もう一度最初から取る（家系カメラで店を選び直すとき。#190）。
     * 地名やブラウザの位置で探し直していれば、その場所のまま。まだ無ければ first と同じ。
     */
    /** まだ返っていない検索を無効にする（家系カメラで店を選んだとき。選んだ候補の場所を書き換えさせない）。 */
    settle() {
      ++asked;
    },
    async again(): Promise<Page> {
      if (!origin) return this.first();
      // 選び直しも 1 回の頼みとして数え、まだ返っていない古い検索に場所を書き換えさせない。
      ++asked;
      return nearby(await ready(), 0, origin);
    },
    /** ブラウザの位置で探し直す（家系カメラ #190。店の中にいるので、市区町村の推定より近くを正しく出す）。 */
    async here(): Promise<Page | null> {
      const mine = ++asked;
      const [client, pos] = await Promise.all([ready(), requestBrowserPosition()]);
      if (!pos) return null;
      return from(mine, client, browserOrigin(pos));
    },
    async next(offset: number): Promise<Page> {
      return nearby(await ready(), offset, origin);
    },
  };
}
