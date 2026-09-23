/**
 * 家系ラーメンを探す MCP Apps サーバー。
 *
 * 4 つのモードをそれぞれ tool として公開し、すべて同じ UI リソースを描画する:
 *   search-iekei-ramen       検索フォーム（都道府県・味・キーワード）
 *   find-nearby-iekei-ramen  現在地から近い 5 店舗
 *   show-iekei-ramen-map     日本地図
 *   decide-iekei-ramen       3 軒まで絞って、モデルに 1 軒推させる
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
import { APP_HTML } from "./src/generated/app-html.ts";
import { distanceKm, formatDistance, originLabel } from "./src/lib/geo.ts";
import { PayloadSchema } from "./src/lib/schema.ts";
import { describeBasis, shortlist } from "./src/lib/shortlist.ts";
import {
  CONFIDENCE,
  ORIGIN_NOTES,
  TASTES,
  type AppPayload,
  type Origin,
  type OriginSource,
  type Shop,
  type TasteKey,
} from "./src/lib/types.ts";

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
    // 家系と確定していない店をモデルが断定しないよう、段階を必ず添える。
    const conf = s.confidence === "confirmed" ? "" : ` / ${CONFIDENCE[s.confidence].label}`;
    return `${i + 1}. ${s.name} (${TASTES[s.taste].label}${conf}${dist})\n   ${where}${s.openingHours ? `\n   営業: ${s.openingHours}` : ""}`;
  });
  const caveat = shops.some((s) => s.confidence !== "confirmed")
    ? "\n\n※「家系の可能性」「家系か未判定」は店名からの推定です。断定しないでください。"
    : "";
  return `${heading}\n\n${lines.join("\n")}${caveat}`;
}

/**
 * 地図モードのテキスト。件数だけ返すと、未判定の店まで家系だと断定して
 * 伝わってしまう。一覧を出さないぶん、内訳と断り書きをここで添える。
 */
function mapSummary(shops: Shop[], prefecture?: string): string {
  const where = prefecture ?? "全国";
  if (shops.length === 0) return `${where}に該当する店舗はありませんでした。`;

  const counts = shops.reduce<Partial<Record<Shop["confidence"], number>>>((acc, s) => {
    acc[s.confidence] = (acc[s.confidence] ?? 0) + 1;
    return acc;
  }, {});
  const breakdown = (["confirmed", "likely", "candidate"] as const)
    .filter((k) => counts[k])
    .map((k) => `${CONFIDENCE[k].label} ${counts[k]} 件`)
    .join(" / ");
  const caveat = shops.some((s) => s.confidence !== "confirmed")
    ? "\n「家系の可能性」「家系か未判定」は店名からの推定です。断定しないでください。"
    : "";
  return `${where}の家系ラーメン ${shops.length} 件を地図に表示しました。\n内訳: ${breakdown}${caveat}`;
}

/**
 * 「迷ったら」のテキスト。
 *
 * **ここだけは、モデルへの依頼文を兼ねている。** 3 軒を渡して終わりにすると、
 * モデルは一覧をなぞるだけで終わり、ユーザーは結局決められない。1 軒を選んで
 * 理由を言い切らせるところまでを頼む。
 *
 * ただし、このデータには味も混雑も評判も無い。理由を自由に書かせると、
 * モデルは知識から「濃厚で人気」などと補ってしまうので、使っていい材料を
 * 明示して縛る。
 */
function decidePrompt(shops: Shop[], basis: string, cond: string): string {
  if (shops.length === 0) {
    return `【${cond}】条件に合う店舗が見つかりませんでした。条件を緩めて試してください。`;
  }
  const lines = shops.map((s, i) => {
    const where = [s.prefecture, s.city, s.address].filter(Boolean).join(" ");
    const dist = s.distanceKm !== undefined ? ` / ${formatDistance(s.distanceKm)}` : "";
    const conf = s.confidence === "confirmed" ? "" : ` / ${CONFIDENCE[s.confidence].label}`;
    const taste =
      s.taste === "unknown"
        ? "味の傾向は情報なし"
        : `味の傾向 ${TASTES[s.taste].label}（既知ブランドからの参考値）`;
    return [
      `${i + 1}. ${s.name}（${taste}${conf}${dist}）`,
      `   ${where}`,
      s.openingHours
        ? `   営業: ${s.openingHours}（OSM 由来。変わることがある）`
        : "   営業時間: データなし",
      s.brand ? `   ブランド: ${s.brand}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");
  });

  /*
   * 軒数は必ず実際の件数から出す。最終巡は 3 軒に満たないことがあり
   * （母数が 3 の倍数でなければ必ず起きる）、1 軒しか無いのに
   * 「選ばなかった 2 軒について」と頼むと、モデルは無い店を作って答える。
   */
  const n = shops.length;
  const ask =
    n === 1
      ? ["候補はこの 1 軒だけです。どういう人に向くかを 2〜3 文で述べてください。"]
      : [
          `この ${n} 軒から 1 軒を選び、なぜそれを推すのかを 2〜3 文で述べてください。`,
          `選ばなかった ${n - 1} 軒についても、どういう人ならそちらが向くかを一言ずつ添えてください。`,
        ];

  return [
    n === 1 ? `【${cond}】候補はこの 1 軒です。` : `【${cond}】この ${n} 軒まで絞りました。`,
    basis,
    "",
    lines.join("\n"),
    "",
    ask[0],
    "理由に使っていいのは上に書いた情報だけです（判定の段階・味の傾向・距離・営業時間・ブランド）。",
    "味の濃さ・混雑・行列・評判・口コミは、このアプリのデータには含まれていません。推測で補わず、",
    "分からないことは分からないと言ってください。",
    ...ask.slice(1),
  ].join("\n");
}

/**
 * 片方だけの座標は受け付けない。
 *
 * 黙って無視すると、呼んだ側は距離で並んだつもりなのに、実際は営業時間の
 * 有無で並んだ別物が返る。モデルが座標を片方だけ出したときに、無関係な店を
 * 「近くの店」として見せてしまう。
 */
function incompleteCoordinates(lat?: number, lon?: number): CallToolResult | undefined {
  if ((lat === undefined) === (lon === undefined)) return undefined;
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: "緯度と経度は両方そろえて指定してください。片方だけでは位置を決められません。",
      },
    ],
  };
}

/**
 * 表示名の正規化。空白だけなら無いものとして扱う。
 *
 * スキーマは空文字も通す。そのまま持つと「【全国】」（条件から落ちる）や
 * 「基準: 」（空のまま出る）のように、場所の抜けた文言があちこちに出る。
 * 入口で無くしておけば、下流はどれも undefined の枝だけを見ればよくなる。
 */
function blankToUndefined(text?: string): string | undefined {
  return text?.trim() || undefined;
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
  /** ChatGPT は仕様上 number だが実際には文字列で送ってくるので、どちらも受ける。 */
  latitude?: number | string;
  longitude?: number | string;
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
}

/** 数値にも文字列にも入りうる座標を number に揃える。範囲外や解釈不能なら undefined。 */
function toCoordinate(value: unknown, max: number): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > max) return undefined;
  return n;
}

/**
 * Cloudflare が付けてくる接続元の位置情報。
 *
 * ホストが位置を渡してこない場合（Claude など）の最後の手段。
 * 値は `request.cf` に入り、緯度経度は文字列で来る。
 * ホストがサーバー側から中継していると、その中継元の位置になってしまうので
 * あくまで最後に試す。
 */
/**
 * stdio 実行時に接続元の位置を引くためのエンドポイント。
 * HTTP で動いていれば request.cf を直接読めるので、そちらでは使わない。
 * 空文字を設定すると問い合わせ自体を行わない（テストはこれで外部通信を止める）。
 */
const LOCATION_ENDPOINT =
  globalThis.process?.env?.IEKEI_LOCATION_ENDPOINT ??
  "https://iekei-ramen-mcp.yamazaki-dev.workers.dev/whereami";

/** プロセスが生きている間は使い回す（同じ場所から何度も引く意味がない）。 */
let edgeLocationCache: Origin | null | undefined;

/** 位置照会エンドポイントに問い合わせる。失敗したら null を覚えて以後は諦める。 */
async function fetchEdgeLocation(): Promise<Origin | undefined> {
  if (!LOCATION_ENDPOINT) return undefined;
  if (edgeLocationCache !== undefined) return edgeLocationCache ?? undefined;
  try {
    const res = await fetch(LOCATION_ENDPOINT, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(String(res.status));
    const cf = (await res.json()) as Record<string, unknown>;
    const lat = toCoordinate(cf.latitude, 90);
    const lon = toCoordinate(cf.longitude, 180);
    edgeLocationCache =
      lat === undefined || lon === undefined
        ? null
        : {
            lat,
            lon,
            label: [cf.city, cf.region].filter((v) => typeof v === "string").join(" ") || undefined,
            source: "edge",
          };
  } catch {
    edgeLocationCache = null;
  }
  return edgeLocationCache ?? undefined;
}

function readEdgeLocation(request: Request | undefined): Origin | undefined {
  const cf = (request as { cf?: Record<string, unknown> } | undefined)?.cf;
  const lat = toCoordinate(cf?.latitude, 90);
  const lon = toCoordinate(cf?.longitude, 180);
  if (lat === undefined || lon === undefined) return undefined;
  return {
    lat,
    lon,
    label: [cf?.city, cf?.region].filter((v) => typeof v === "string").join(" ") || undefined,
    source: "edge",
  };
}

/** `_meta` からホスト由来の現在地を取り出す。無ければ undefined。 */
function readHostLocation(meta: Record<string, unknown> | undefined): Origin | undefined {
  const raw = meta?.["openai/userLocation"] as HostUserLocation | undefined;
  const lat = toCoordinate(raw?.latitude, 90);
  const lon = toCoordinate(raw?.longitude, 180);
  if (lat === undefined || lon === undefined) return undefined;
  return {
    lat,
    lon,
    label: [raw?.city, raw?.region].filter(Boolean).join(" ") || undefined,
    source: "host",
  };
}

/** UI へ渡す structuredContent。都道府県リストは毎回添える。 */
function structured(payload: Omit<AppPayload, "prefectures">) {
  return { ...payload, prefectures: PREFECTURES_WITH_SHOPS };
}

export function createServer(): McpServer {
  /*
   * 名乗りは環境変数で上書きできる。検証ホストはプレビューと共用しており
   * （E2E のたびに立て直すと見ている画面が消える）、サーバーが 2 つ並ぶ。
   * 同じ名前だと E2E がどちらを選んだか確かめられないので、E2E 用だけ
   * 名前を変えて選び分ける。既定は本番の名前。
   */
  const server = new McpServer({
    name: process.env.IEKEI_SERVER_NAME ?? "Iekei Ramen Finder",
    version: "0.1.0",
  });

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
      const kw = blankToUndefined(keyword);
      const all = filterShops({ prefecture, taste, keyword: kw });
      const shops = all.slice(0, 200);
      const cond =
        [prefecture, taste && TASTES[taste].label, kw].filter(Boolean).join(" / ") || "全国";
      const payload: Omit<AppPayload, "prefectures"> = {
        mode: "form",
        shops,
        total: all.length,
        query: { prefecture, taste, keyword: kw },
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
      _meta: { ui: { resourceUri } },
    },
    async ({ lat, lon, limit, label, source }, ctx): Promise<CallToolResult> => {
      const incomplete = incompleteCoordinates(lat, lon);
      if (incomplete) return incomplete;

      // TODO(診断): ホストがどんな _meta を送ってくるかを確認するための一時ログ。
      // 原因が特定できたら消す。位置の値そのものは出さず、キーだけ記録する。
      // 精度の高い順に降りていく。引数 → ホストが渡す位置 → 接続元からの推定。
      // 最後のものは HTTP なら request.cf から、stdio なら照会エンドポイントから取る。
      const origin: Origin | undefined =
        lat !== undefined && lon !== undefined
          ? {
              lat,
              lon,
              label: blankToUndefined(label),
              source: (source ?? "precise") as OriginSource,
            }
          : (readHostLocation(ctx.mcpReq._meta) ??
            readEdgeLocation(ctx.http?.req) ??
            (await fetchEdgeLocation()));

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
            text: mapSummary(shops, prefecture),
          },
        ],
        structuredContent: structured(payload),
      };
    },
  );

  // --- 4. 迷ったら（3 軒に絞る） ---------------------------------------------------------
  registerAppTool(
    server,
    "decide-iekei-ramen",
    {
      title: "家系ラーメンを 3 軒まで絞る",
      description:
        "条件に合う家系ラーメン店を 3 軒まで絞り込み、その中から 1 軒を理由つきで推すための UI を表示する。一覧を見せても決められないとき、または「どこにする？」「おすすめは？」と聞かれたときに使う。round を 1 つ増やすと次の 3 軒に入れ替わる。",
      inputSchema: z.object({
        prefecture: z.enum(ALL_PREFECTURES).optional().describe("都道府県名（例: 神奈川県）"),
        taste: z
          .enum(["rich", "creamy", "chain"])
          .optional()
          .describe("味の傾向: rich=直系・濃厚 / creamy=クリーミー / chain=チェーン・万人向け"),
        keyword: z.string().optional().describe("店名・ブランド・地名の部分一致キーワード"),
        lat: z.number().min(-90).max(90).optional().describe("基準地点の緯度。あれば近い順に絞る"),
        lon: z.number().min(-180).max(180).optional().describe("基準地点の経度"),
        label: z.string().optional().describe("基準地点の表示名（例: 横浜駅）"),
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
      _meta: { ui: { resourceUri } },
    },
    async ({
      prefecture,
      taste,
      keyword,
      lat,
      lon,
      label,
      source,
      round,
    }): Promise<CallToolResult> => {
      const incomplete = incompleteCoordinates(lat, lon);
      if (incomplete) return incomplete;

      /*
       * 出どころは受け取ったものをそのまま持つ。ここで place に固定すると、
       * 端末の位置情報から来た座標まで「指定した地名」に化け、現在地モードへ
       * 戻ったときに誤った精度が表示される。
       */
      const origin: Origin | undefined =
        lat !== undefined && lon !== undefined
          ? {
              lat,
              lon,
              label: blankToUndefined(label),
              source: (source ?? "place") as OriginSource,
            }
          : undefined;
      /*
       * 効かないキーワードを持ち回らない。filterShops は trim 後に空なら
       * 絞り込まないのに、生の値を payload と説明文に残すと、UI には外せる
       * チップが出て、モデルには「この語に合う 558 軒」と伝わる。
       */
      const kw = blankToUndefined(keyword);
      const list = shortlist(filterShops({ prefecture, taste, keyword: kw }), { origin, round });
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
        },
      };
      return {
        content: [
          {
            type: "text",
            text: decidePrompt(
              list.picks,
              describeBasis(list, list.picks.length, origin, kw),
              cond,
            ),
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
