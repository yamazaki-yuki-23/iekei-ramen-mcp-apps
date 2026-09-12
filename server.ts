/**
 * 家系ラーメンを探す MCP Apps サーバー。
 *
 * 3 つのモードをそれぞれ tool として公開し、すべて同じ UI リソースを描画する:
 *   search-iekei-ramen       検索フォーム（都道府県・味・キーワード）
 *   find-nearby-iekei-ramen  現在地から近い 5 店舗
 *   show-iekei-ramen-map     日本地図
 * geocode-place は UI から呼ぶ補助 tool（UI を持たない）。
 */
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  type CallToolResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import shopsData from "./data/shops.json" with { type: "json" };
import { APP_HTML } from "./src/generated/app-html.js";
import { distanceKm, formatDistance } from "./src/lib/geo.js";
import { PayloadSchema } from "./src/lib/schema.js";
import {
  ORIGIN_NOTES,
  TASTES,
  type AppPayload,
  type Origin,
  type OriginSource,
  type Shop,
  type TasteKey,
} from "./src/lib/types.js";

const SHOPS = shopsData as Shop[];

/** tool の入力スキーマ用。データに 0 件の県でも選べるよう全 47 都道府県を固定で持つ。 */
const ALL_PREFECTURES = [
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県",
] as const;

/** UI のプルダウン用。実際に店舗が 1 件以上ある県だけ。 */
const PREFECTURES_WITH_SHOPS = ALL_PREFECTURES.filter((p) => SHOPS.some((s) => s.prefecture === p));

const resourceUri = "ui://iekei-ramen/mcp-app.html";

/**
 * UI リソースのメタデータ。
 * - csp: 地図タイルを OSM から読むために必要
 * - permissions.geolocation: 「現在地から探す」で navigator.geolocation を使うため
 */
const uiResourceMeta = {
  ui: {
    csp: {
      connectDomains: ["https://*.openstreetmap.org"],
      resourceDomains: ["https://*.openstreetmap.org", "https://*.tile.openstreetmap.org"],
    },
    permissions: { geolocation: {} },
    prefersBorder: true,
  },
};

/** LLM 向けのテキスト要約。UI を描画しないホストではこれだけが返る。 */
function summarize(shops: Shop[], heading: string, withDistance = false): string {
  if (shops.length === 0) return `${heading}\n該当する店舗は見つかりませんでした。`;
  const lines = shops.map((s, i) => {
    const dist =
      withDistance && s.distanceKm !== undefined ? ` / ${formatDistance(s.distanceKm)}` : "";
    const where = [s.prefecture, s.city, s.address].filter(Boolean).join(" ");
    return `${i + 1}. ${s.name} (${TASTES[s.taste].label}${dist})\n   ${where}${s.openingHours ? `\n   営業: ${s.openingHours}` : ""}`;
  });
  return `${heading}\n\n${lines.join("\n")}`;
}

function filterShops(opts: { prefecture?: string; taste?: TasteKey; keyword?: string }): Shop[] {
  const kw = opts.keyword?.trim().toLowerCase();
  return SHOPS.filter((s) => {
    if (opts.prefecture && s.prefecture !== opts.prefecture) return false;
    if (opts.taste && opts.taste !== "unknown" && s.taste !== opts.taste) return false;
    if (kw) {
      const hay = [s.name, s.nameEn, s.brand, s.city, s.address].join(" ").toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

/**
 * ホストが tool 呼び出しに添えてくる大まかな現在地。
 *
 * ChatGPT はアプリの iframe に geolocation を許可しないため、UI 側の
 * navigator.geolocation は必ず失敗する。代わりにホストが _meta で
 * 市区町村レベルの座標を渡してくるので、それを基準地点に使う。
 * あくまでヒントなので、欠けていても動くようにしておくこと。
 */
interface HostUserLocation {
  latitude?: number;
  longitude?: number;
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
}

/** `_meta` からホスト由来の現在地を取り出す。無ければ undefined。 */
function readHostLocation(meta: Record<string, unknown> | undefined): Origin | undefined {
  const raw = meta?.["openai/userLocation"] as HostUserLocation | undefined;
  if (typeof raw?.latitude !== "number" || typeof raw?.longitude !== "number") return undefined;
  return {
    lat: raw.latitude,
    lon: raw.longitude,
    label: [raw.city, raw.region].filter(Boolean).join(" ") || undefined,
    source: "host",
  };
}

/** UI へ渡す structuredContent。都道府県リストは毎回添える。 */
function structured(payload: Omit<AppPayload, "prefectures">) {
  return { ...payload, prefectures: PREFECTURES_WITH_SHOPS };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "Iekei Ramen Finder", version: "0.1.0" });

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => ({
      contents: [
        { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: APP_HTML, _meta: uiResourceMeta },
      ],
    }),
  );

  // --- 1. 検索フォーム -----------------------------------------------------
  registerAppTool(
    server,
    "search-iekei-ramen",
    {
      title: "家系ラーメンを検索",
      description:
        "都道府県・味の傾向・キーワードで全国の家系ラーメン店を絞り込み、検索フォーム付きの一覧 UI を表示する。条件を指定しなければ全国の一覧を返す。",
      inputSchema: z.object({
        prefecture: z.enum(ALL_PREFECTURES).optional().describe("都道府県名（例: 神奈川県）"),
        taste: z
          .enum(["rich", "creamy", "chain"])
          .optional()
          .describe("味の傾向: rich=直系・濃厚 / creamy=クリーミー / chain=チェーン・万人向け"),
        keyword: z.string().optional().describe("店名・ブランド・地名の部分一致キーワード"),
      }),
      outputSchema: PayloadSchema,
      _meta: { ui: { resourceUri } },
    },
    async ({ prefecture, taste, keyword }): Promise<CallToolResult> => {
      const all = filterShops({ prefecture, taste, keyword });
      const shops = all.slice(0, 200);
      const cond =
        [prefecture, taste && TASTES[taste].label, keyword].filter(Boolean).join(" / ") || "全国";
      const payload: Omit<AppPayload, "prefectures"> = {
        mode: "form",
        shops,
        total: all.length,
        query: { prefecture, taste, keyword },
      };
      return {
        content: [
          {
            type: "text",
            text: summarize(shops.slice(0, 10), `【${cond}】${all.length} 件ヒット（上位 10 件）`),
          },
        ],
        structuredContent: structured(payload),
      };
    },
  );

  // --- 2. 現在地から探す ---------------------------------------------------
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
          .describe("基準地点の緯度。省略するとホストの現在地を使う"),
        lon: z
          .number()
          .min(-180)
          .max(180)
          .optional()
          .describe("基準地点の経度。省略するとホストの現在地を使う"),
        limit: z.number().int().min(1).max(20).default(5).describe("提案する店舗数"),
        label: z.string().optional().describe("基準地点の表示名（例: 横浜駅）"),
        source: z
          .enum(["precise", "place"])
          .optional()
          .describe("緯度経度の出どころ: precise=端末の位置情報 / place=地名から解決"),
      }),
      outputSchema: PayloadSchema,
      _meta: { ui: { resourceUri } },
    },
    async ({ lat, lon, limit, label, source }, ctx): Promise<CallToolResult> => {
      // 引数の座標があればそれを使い、無ければホストの大まかな現在地に頼る。
      const origin: Origin | undefined =
        lat !== undefined && lon !== undefined
          ? { lat, lon, label, source: (source ?? "precise") as OriginSource }
          : readHostLocation(ctx.mcpReq._meta);

      if (!origin) {
        // ホストが位置情報を渡さない環境。UI は地名入力へ誘導する。
        return {
          content: [
            {
              type: "text",
              text: "現在地を特定できませんでした。地名を指定してください（例: 横浜駅）。",
            },
          ],
          structuredContent: structured({
            mode: "nearby",
            shops: [],
            total: 0,
            query: {},
          }),
        };
      }

      const ranked = SHOPS.map((s) => ({
        ...s,
        distanceKm: Number(distanceKm(origin.lat, origin.lon, s.lat, s.lon).toFixed(3)),
      }))
        .toSorted((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, limit);
      const payload: Omit<AppPayload, "prefectures"> = {
        mode: "nearby",
        shops: ranked,
        total: ranked.length,
        query: { origin },
      };
      const where = origin.label ?? `${origin.lat.toFixed(4)}, ${origin.lon.toFixed(4)}`;
      const note = origin.source === "host" ? `（${ORIGIN_NOTES.host}）` : "";
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
        structuredContent: structured(payload),
      };
    },
  );

  // --- 3. 地図から探す -----------------------------------------------------
  registerAppTool(
    server,
    "show-iekei-ramen-map",
    {
      title: "家系ラーメンを地図で見る",
      description:
        "全国の家系ラーメン店を日本地図上にプロットして表示する。都道府県や味で絞り込んだ状態で開くこともできる。",
      inputSchema: z.object({
        prefecture: z.enum(ALL_PREFECTURES).optional().describe("この都道府県にズームして表示する"),
        taste: z.enum(["rich", "creamy", "chain"]).optional().describe("味の傾向で絞り込む"),
      }),
      outputSchema: PayloadSchema,
      _meta: { ui: { resourceUri } },
    },
    async ({ prefecture, taste }): Promise<CallToolResult> => {
      const shops = filterShops({ prefecture, taste });
      const payload: Omit<AppPayload, "prefectures"> = {
        mode: "map",
        shops,
        total: shops.length,
        query: { prefecture, taste },
      };
      return {
        content: [
          {
            type: "text",
            text: `${prefecture ?? "全国"}の家系ラーメン ${shops.length} 件を地図に表示しました。`,
          },
        ],
        structuredContent: structured(payload),
      };
    },
  );

  // --- 補助: 地名 → 緯度経度 ----------------------------------------------
  server.registerTool(
    "geocode-place",
    {
      title: "地名から緯度経度を調べる",
      description:
        "地名や住所を OpenStreetMap Nominatim で緯度経度に変換する。find-nearby-iekei-ramen の前段として使う。",
      inputSchema: z.object({ query: z.string().describe("地名・駅名・住所") }),
    },
    async ({ query }): Promise<CallToolResult> => {
      const params = new URLSearchParams({
        q: query,
        format: "json",
        limit: "3",
        "accept-language": "ja",
      });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { "User-Agent": "iekei-ramen-mcp-apps/0.1" },
      });
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `ジオコーディングに失敗しました: ${res.status}` }],
          isError: true,
        };
      }
      const results = (await res.json()) as Array<{
        display_name: string;
        lat: string;
        lon: string;
      }>;
      if (results.length === 0) {
        return { content: [{ type: "text", text: `「${query}」は見つかりませんでした。` }] };
      }
      return {
        content: [
          {
            type: "text",
            text: results
              .map((r) => `${r.display_name}\n  lat=${r.lat}, lon=${r.lon}`)
              .join("\n\n"),
          },
        ],
        structuredContent: {
          results: results.map((r) => ({
            label: r.display_name,
            lat: Number(r.lat),
            lon: Number(r.lon),
          })),
        },
      };
    },
  );

  return server;
}
