import { ALL_PREFECTURES } from "./src/lib/prefectures.ts";
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
  type ListToolsRequest,
  type ListToolsResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import shopsData from "./data/shops.json" with { type: "json" };
import { APP_HTML } from "./src/generated/app-html.ts";
import { distanceKm, formatDistance, originLabel } from "./src/lib/geo.ts";
import { dataCaveats } from "./src/lib/data-caveats.ts";
import { GEOCODE_MAX_WAIT_MS } from "./src/lib/geocode-gate.ts";
import {
  GEOCODE_RESPONSE_TIMEOUT_MS,
  GeocodeTimeoutError,
  withGeocodeTimeout,
} from "./src/lib/geocode-timeout.ts";
import { summarize as summarizeVisits } from "./src/lib/progress.ts";
import { RECORDS_WITHOUT_SHOPS } from "./src/lib/visited-view.ts";
import { BoundsSchema, PayloadSchema, StampResultSchema } from "./src/lib/schema.ts";
import { scopeLabel } from "./src/lib/scope.ts";
import type { VisitStore } from "./src/lib/visits.ts";
import { describeBasis, shortlist } from "./src/lib/shortlist.ts";
import {
  CONFIDENCE,
  ORIGIN_NOTES,
  TASTES,
  type AppPayload,
  type Bounds,
  type DecideInfo,
  type Origin,
  type OriginSource,
  type Shop,
  type TasteKey,
} from "./src/lib/types.ts";

const DEFAULT_SHOPS = shopsData as Shop[];

/** 本番既定データの選択肢は起動時に一度だけ導出する。 */
const DEFAULT_PREFECTURES = ALL_PREFECTURES.filter((p) =>
  DEFAULT_SHOPS.some((s) => s.prefecture === p),
);

const resourceUri = "ui://iekei-ramen/mcp-app.html";

/**
 * UI リソースのメタデータ。
 * - csp: 地図タイルを OSM から読むために必要
 * - permissions.geolocation: 「現在地から探す」で navigator.geolocation を使うため
 */
const uiResourceMeta = {
  ui: {
    domain: "https://iekeiramen.com",
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
  const notes = dataCaveats(shops);
  const caveat = notes ? `\n\n${notes}` : "";
  return `${heading}\n\n${lines.join("\n")}${caveat}`;
}

/**
 * 地図モードのテキスト。件数だけ返すと、未判定の店まで家系だと断定して
 * 伝わってしまう。一覧を出さないぶん、内訳と断り書きをここで添える。
 */
function mapSummary(shops: Shop[], prefecture?: string, bounds?: Bounds): string {
  /*
   * 範囲で絞ったときは「全国」と名乗らない。
   *
   * **どこを見ているかはモデルに分からない。** 画面に出ている範囲だと
   * 言っておかないと、モデルが「全国で 12 件しかない」と読んで話す。
   * 語は UI の見出しと共通（[scope.ts](src/lib/scope.ts)）。
   */
  const where = scopeLabel({ prefecture, bounds });
  if (shops.length === 0) return `${where}に該当する店舗はありませんでした。`;

  const counts = shops.reduce<Partial<Record<Shop["confidence"], number>>>((acc, s) => {
    acc[s.confidence] = (acc[s.confidence] ?? 0) + 1;
    return acc;
  }, {});
  const breakdown = (["confirmed", "likely", "candidate"] as const)
    .filter((k) => counts[k])
    .map((k) => `${CONFIDENCE[k].label} ${counts[k]} 件`)
    .join(" / ");
  const notes = dataCaveats(shops);
  const caveat = notes ? `\n${notes}` : "";
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
function decidePrompt(shops: Shop[], basis: string, cond: string, info: DecideInfo): string {
  if (shops.length === 0) {
    return `【${cond}】条件に合う店舗が見つかりませんでした。条件を緩めて試してください。`;
  }
  const lines = shops.map((s, i) => {
    const where = [s.prefecture, s.city, s.address].filter(Boolean).join(" ");
    const dist = s.distanceKm !== undefined ? ` / ${formatDistance(s.distanceKm)}` : "";
    const conf = s.confidence === "confirmed" ? "" : ` / ${CONFIDENCE[s.confidence].label}`;
    const taste =
      s.taste === "unknown" ? "味の傾向は情報なし" : `味の傾向 ${TASTES[s.taste].label}`;
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
    dataCaveats(shops, info),
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

function filterShops(
  dataset: Shop[],
  opts: {
    prefecture?: string;
    taste?: TasteKey;
    keyword?: string;
    bounds?: Bounds;
  },
): Shop[] {
  const kw = opts.keyword?.trim().toLowerCase();
  const b = opts.bounds;
  return dataset.filter((s) => {
    if (opts.prefecture && s.prefecture !== opts.prefecture) return false;
    if (opts.taste && opts.taste !== "unknown" && s.taste !== opts.taste) return false;
    // 範囲は南西・北東の角で来る。日付変更線はまたがない（国内だけのデータ）。
    if (b && (s.lat < b.south || s.lat > b.north || s.lon < b.west || s.lon > b.east)) return false;
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
  globalThis.process?.env?.IEKEI_LOCATION_ENDPOINT ?? "https://iekeiramen.com/whereami";

/** プロセスが生きている間は使い回す（同じ場所から何度も引く意味がない）。 */
let edgeLocationCache: Origin | null | undefined;

/** 位置照会エンドポイントに問い合わせる。失敗したら null を覚えて以後は諦める。 */
async function fetchEdgeLocation(): Promise<Origin | undefined> {
  if (!LOCATION_ENDPOINT) return undefined;
  if (edgeLocationCache !== undefined) return edgeLocationCache ?? undefined;
  try {
    const res = await fetch(LOCATION_ENDPOINT, {
      signal: AbortSignal.timeout(3000),
    });
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
/** 検索条件の欄。**文言が同じ tool だけで共有する**——説明はモデルが読む契約で、
 * 地図の「この都道府県にズームして表示する」とは伝えることが違う。 */
const conditionFields = {
  prefecture: z.enum(ALL_PREFECTURES).optional().describe("都道府県名（例: 神奈川県）"),
  taste: z
    .enum(["rich", "creamy", "chain"])
    .optional()
    .describe("味の傾向: rich=直系・濃厚 / creamy=クリーミー / chain=チェーン・万人向け"),
  keyword: z.string().optional().describe("店名・ブランド・地名の部分一致キーワード"),
};

/** 引数から基準地点を組み立てる。**既定の出どころは tool ごとに違う**ので受け取る。
 * 緯度と経度が揃っていなければ基準地点は無い。 */
function originFrom(
  args: { lat?: number; lon?: number; label?: string; source?: string },
  fallback: OriginSource,
): Origin | undefined {
  if (args.lat === undefined || args.lon === undefined) return undefined;
  return {
    lat: args.lat,
    lon: args.lon,
    label: blankToUndefined(args.label),
    source: (args.source ?? fallback) as OriginSource,
  };
}

function structured(payload: Omit<AppPayload, "prefectures">, prefectures: string[]) {
  return { ...payload, prefectures };
}

/**
 * サインインしている人に渡す追加分。
 *
 * **匿名のときは何も足さない。** 空配列を入れると、UI から見て
 * 「サインインしていて 0 軒」と区別が付かなくなる。
 */
async function visitorExtras(deps: ServerDeps, dataset: Shop[]): Promise<Partial<AppPayload>> {
  if (!deps.visitor || !deps.visits) return {};
  const visited = await deps.visits.list(deps.visitor.id);
  return { visited, progress: summarizeVisits(dataset, visited) };
}

/**
 * サインインが要る tool。
 *
 * **worker 側がこの名前を見て 401 を返す。** tool の中からは HTTP の状態を
 * 決められないので、入口で止めるしかない。
 */
export const MEMBER_TOOLS = [
  "stamp-iekei-ramen",
  "show-visited-iekei-ramen",
  "forget-my-iekei-ramen-visits",
] as const;

/** SDKが保持する_metaで認証方式を宣言し、HTTPの認証対象と同じ集合から導く。 */
function toolMetadata(name: string, withUi = true) {
  const member = (MEMBER_TOOLS as readonly string[]).includes(name);
  const oauth = { type: "oauth2", scopes: ["stamp"] };
  const securitySchemes = member
    ? [oauth]
    : name === "geocode-place"
      ? [{ type: "noauth" }]
      : [{ type: "noauth" }, oauth];
  const modifiesVisits = name === "stamp-iekei-ramen" || name === "forget-my-iekei-ramen-visits";
  return {
    annotations: {
      readOnlyHint: !modifiesVisits,
      // スタンプも visited=false なら既存の印を削除する。
      destructiveHint: modifiesVisits,
      openWorldHint: name === "geocode-place",
      idempotentHint: true,
    },
    _meta: {
      securitySchemes,
      ...(withUi ? { ui: { resourceUri } } : {}),
    },
  };
}

export interface ServerDeps {
  /** データ供給境界。省略時は同梱の実店舗データ。本番 Worker は差し替えない。 */
  shops?: Shop[];
  /** サインインしている人。匿名なら null。 */
  visitor?: { id: string } | null;
  /** 記録の置き場。ローカル実行では無い。 */
  visits?: VisitStore;
  /**
   * 地名検索の結果の置き場。**Nominatim は結果を手元に持つことを求めている。**
   * Cache API は workers.dev では効かない（独自ドメインでだけ動く）ので KV に置く。
   * ローカル実行では無く、毎回問い合わせる。
   */
  geocodeCache?: Pick<KVNamespace, "get" | "put">;
  /**
   * いま Nominatim へ問い合わせてよいか（同じ接続元からの連打止め）。
   * 無ければ止めない（手元の Node サーバー）。
   */
  allowGeocode?: () => Promise<boolean>;
  /**
   * Nominatim への送り口。**全体の「1 秒 1 回」はここが守る**（worker.ts が
   * Durable Object の列を渡す）。無ければ直接送る（手元の Node サーバー）。
   * 待たせすぎになるときは 429 を返す。
   */
  nominatim?: (url: string, init: RequestInit) => Promise<Response>;
  /**
   * tool が受け付けられたとき（引数の検査を通った後）に呼ぶ。使われているかを
   * 数えるため（worker.ts）。本文を読んで数えると、引数が足りず SDK が弾いた
   * 呼び出しまで数えてしまう。
   */
  onToolCall?: (name: string, args: unknown) => void;
}

/** Nominatim の利用ポリシーが求める「アプリと連絡先が分かる」名乗り。 */
const NOMINATIM_USER_AGENT =
  "iekei-ramen-mcp-apps/0.1 (+https://github.com/yamazaki-yuki-23/iekei-ramen-mcp-apps)";

/** 地名は変わらないので長めに持つ。ポリシーの例も 7 日単位。 */
const GEOCODE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Gate の送信枠待ち最大 3 秒と、外部応答・本文の最大 10 秒を合わせる。 */
const GEOCODE_GATE_CALL_TIMEOUT_MS = GEOCODE_MAX_WAIT_MS + GEOCODE_RESPONSE_TIMEOUT_MS;

const geocodeTimeoutResult = (): CallToolResult => ({
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
async function readGeocodeCache(
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
async function geocodeCacheKey(q: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(q));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `geocode:${hex}`;
}

export function createServer(deps: ServerDeps = {}): McpServer {
  const dataset = deps.shops ?? DEFAULT_SHOPS;
  const prefectures =
    dataset === DEFAULT_SHOPS
      ? DEFAULT_PREFECTURES
      : ALL_PREFECTURES.filter((p) => dataset.some((s) => s.prefecture === p));
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

  /*
   * SDKのtools/listが独自のトップレベルキーを落とすため、SDK自身の一覧ハンドラの
   * 戻り値だけを拡張する。スキーマ変換・有効/無効・通知はSDKに任せる。
   * 初期登録中だけ捕捉し、登録後は公開APIを元に戻す。
   */
  const setRequestHandler = server.server.setRequestHandler.bind(server.server);
  type ListToolsHandler = (
    request: ListToolsRequest,
    ctx: ServerContext,
  ) => ListToolsResult | Promise<ListToolsResult>;
  server.server.setRequestHandler = ((method: string, handler: ListToolsHandler) => {
    if (method === "tools/list") {
      setRequestHandler("tools/list", async (request, ctx) => {
        const result = await handler(request, ctx);
        return {
          ...result,
          tools: result.tools.map((tool) => ({
            ...tool,
            securitySchemes: tool._meta?.securitySchemes,
          })),
        };
      });
    } else {
      setRequestHandler(method as never, handler as never);
    }
  }) as typeof server.server.setRequestHandler;

  /*
   * 数える口は registerTool 1 か所に付ける。registerAppTool もここを通り、SDK は
   * 引数を検査してから handler を呼ぶので、弾かれた呼び出しは数えない。tool ごとに
   * 付けると、足した tool だけ数え漏れる。
   */
  const { onToolCall } = deps;
  if (onToolCall) {
    const register = server.registerTool.bind(server);
    server.registerTool = ((name: string, config: never, handler: (...a: never[]) => unknown) =>
      register(name, config, ((...a: never[]) => {
        onToolCall(name, a[0]);
        return handler(...a);
      }) as never)) as typeof server.registerTool;
  }

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => ({
      contents: [
        {
          uri: resourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: APP_HTML,
          _meta: uiResourceMeta,
        },
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
      inputSchema: z.object(conditionFields),
      outputSchema: PayloadSchema,
      ...toolMetadata("search-iekei-ramen"),
    },
    async ({ prefecture, taste, keyword }): Promise<CallToolResult> => {
      const kw = blankToUndefined(keyword);
      const all = filterShops(dataset, { prefecture, taste, keyword: kw });
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
        structuredContent: await withVisitor(payload),
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
          .describe("利用者が地名や地図で指定した地点の緯度。省略するとホストの現在地を使う"),
        lon: z
          .number()
          .min(-180)
          .max(180)
          .optional()
          .describe("利用者が地名や地図で指定した地点の経度。省略するとホストの現在地を使う"),
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
      ...toolMetadata("find-nearby-iekei-ramen"),
    },
    async ({ lat, lon, limit, label, source }, ctx): Promise<CallToolResult> => {
      const incomplete = incompleteCoordinates(lat, lon);
      if (incomplete) return incomplete;

      // 精度の高い順に降りていく。引数 → ホストが渡す位置 → 接続元からの推定。
      // 最後のものは HTTP なら request.cf から、stdio なら照会エンドポイントから取る。
      const origin: Origin | undefined =
        originFrom({ lat, lon, label, source }, "precise") ??
        readHostLocation(ctx.mcpReq._meta) ??
        readEdgeLocation(ctx.http?.req) ??
        (await fetchEdgeLocation());

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
        structuredContent: await withVisitor(payload),
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
        bounds: BoundsSchema.optional().describe(
          "地図に出ている範囲で絞り込む。UI の「この範囲で探す」から渡る",
        ),
        /*
         * 基準地点は絞り込みではなく、地図に印と同心円を出すためのもの。
         * 現在地モードから地図へ移ったときに引き継ぐ。
         */
        lat: z
          .number()
          .min(-90)
          .max(90)
          .optional()
          .describe("利用者が地名や地図で指定した地点の緯度（印と同心円を出す）"),
        lon: z
          .number()
          .min(-180)
          .max(180)
          .optional()
          .describe("利用者が地名や地図で指定した地点の経度"),
        label: z.string().optional().describe("基準地点の表示名（例: 横浜駅）"),
        source: z
          .enum(["precise", "host", "edge", "place"])
          .optional()
          .describe("緯度経度の出どころ。省略すると precise 扱い"),
      }),
      outputSchema: PayloadSchema,
      ...toolMetadata("show-iekei-ramen-map"),
    },
    async ({ prefecture, taste, bounds, lat, lon, label, source }): Promise<CallToolResult> => {
      const shops = filterShops(dataset, { prefecture, taste, bounds });
      // 座標が片方だけ来たときは基準地点として扱わない（地図に嘘の印が出る）。
      const origin = originFrom({ lat, lon, label, source }, "precise");
      const payload: Omit<AppPayload, "prefectures"> = {
        mode: "map",
        shops,
        total: shops.length,
        query: { prefecture, taste, bounds, origin },
      };
      return {
        content: [
          {
            type: "text",
            text: mapSummary(shops, prefecture, bounds),
          },
        ],
        structuredContent: await withVisitor(payload),
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
      const origin = originFrom({ lat, lon, label, source }, "place");
      /*
       * 効かないキーワードを持ち回らない。filterShops は trim 後に空なら
       * 絞り込まないのに、生の値を payload と説明文に残すと、UI には外せる
       * チップが出て、モデルには「この語に合う 558 軒」と伝わる。
       */
      const kw = blankToUndefined(keyword);
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
              describeBasis(list, list.picks.length, origin, kw),
              cond,
              list,
            ),
          },
        ],
        structuredContent: await withVisitor(payload),
      };
    },
  );

  // --- 補助: 地名 → 緯度経度 ----------------------------------------------
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

  /* --- 6. 訪問スタンプ（サインインが要る） -------------------------------- */

  /**
   * ここから下は **worker 側でトークンを確かめてから**呼ばれる。
   * 匿名のまま来た場合は tool に届く前に 401 を返している（MEMBER_TOOLS）。
   * それでも念のため確かめるのは、呼び出し口が増えたときに黙って通らないため。
   */
  /**
   * payload の出口。**ここを通ると訪問情報が自動で乗る。**
   *
   * tool ごとに足すと、足し忘れた tool だけスタンプが出ない、という
   * 見つけにくい穴ができる（実際に最初そうなっていた）。
   */
  /**
   * payload の出口。**ここを通ると訪問情報が自動で乗る。**
   *
   * **読んだ記録があるなら渡すこと。** 中でもう一度読むと、その間に別のホスト
   * から押された 1 件を拾い、**1 つの応答に 2 つの時点が混ざる**（一覧は前の
   * 時点・バッジと制覇率は後の時点）。同じ応答の中で「行った店なのにバッジが
   * 付いていない」が起きる。
   */
  const withVisitor = async (
    payload: Omit<AppPayload, "prefectures">,
    extras?: Partial<AppPayload>,
  ) => ({
    ...structured(payload, prefectures),
    ...(extras ?? (await visitorExtras(deps, dataset))),
  });

  const requireVisitor = () => {
    if (!deps.visitor || !deps.visits) throw new Error("サインインが必要です");
    return { visitor: deps.visitor, visits: deps.visits };
  };

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
      const extras = await visitorExtras(deps, dataset);
      const progress = extras.progress!;
      const snapshot = { visited: extras.visited!, progress };
      // 軽量経路では一覧の抽出とJSON化も省く。同じ読み取りから両形式を組む。
      let structuredContent: Record<string, unknown> = snapshot;
      if (includeShops) {
        const visitedIds = new Set(snapshot.visited);
        structuredContent = {
          ...structured(
            {
              mode: "visited",
              shops: dataset.filter((s) => visitedIds.has(s.id)),
              total: progress.overall.visited,
              query: {},
            },
            prefectures,
          ),
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

  registerAppTool(
    server,
    "show-visited-iekei-ramen",
    {
      title: "行った店と制覇率を見る",
      description:
        "訪問済みの家系ラーメン店の一覧と、県ごと・全国の制覇率を表示する。サインインした人だけが使える。",
      inputSchema: z.object({}),
      outputSchema: PayloadSchema,
      ...toolMetadata("show-visited-iekei-ramen"),
    },
    async (): Promise<CallToolResult> => {
      requireVisitor();
      const extras = await visitorExtras(deps, dataset);
      const progress = extras.progress!;
      const visitedIds = new Set(extras.visited);
      const shops = dataset.filter((s) => visitedIds.has(s.id));
      const payload: Omit<AppPayload, "prefectures"> = {
        mode: "visited",
        shops,
        total: shops.length,
        query: {},
      };
      const top = progress.prefectures
        .slice(0, 5)
        .map((p) => `${p.prefecture} ${p.visited}/${p.total}`)
        .join(" / ");
      /*
       * **「1 軒も記録がない」は、記録の件数で決める。**
       *
       * 一覧が空でも、記録が残っていることがある（データを取り直して店が
       * 消えた場合）。並んでいる店の数で決めると、記録があるのにモデルへ
       * 「まだ 1 軒も記録がありません」と伝え、構造化データと食い違う。
       * 画面と同じ文を渡す（UI は visited-view.ts で同じ判断をしている）。
       */
      const recorded = extras.visited!.length;
      return {
        content: [
          {
            type: "text",
            text:
              recorded === 0
                ? "まだ 1 軒も記録がありません。"
                : shops.length === 0
                  ? RECORDS_WITHOUT_SHOPS
                  : `${progress.overall.visited} 軒（全国 ${progress.overall.total} 軒中 ` +
                    `${progress.overall.percent}%）。${top}`,
          },
        ],
        structuredContent: await withVisitor(payload, extras),
      };
    },
  );

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

  server.server.setRequestHandler = setRequestHandler;
  return server;
}
