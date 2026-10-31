/**
 * 家系ラーメンを探す MCP Apps サーバー。ここは登録だけを持ち、tool の中身は server/tools/ にある。
 *
 * 4 つのモードをそれぞれ tool として公開し、すべて同じ UI リソースを描画する:
 *   search-iekei-ramen       検索フォーム（都道府県・味・キーワード）
 *   find-nearby-iekei-ramen  現在地から近い 5 店舗
 *   show-iekei-ramen-map     日本地図
 *   decide-iekei-ramen       3 軒まで絞って、モデルに 1 軒推させる
 * geocode-place は UI から呼ぶ補助 tool（UI を持たない）。
 * 行った店の記録（stamp・show-visited・forget）はサインインした人だけが使える。
 */
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  type ListToolsRequest,
  type ListToolsResult,
  type ReadResourceResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import shopsData from "../data/shops.json" with { type: "json" };
import { APP_HTML } from "../src/generated/app-html.ts";
import type { AppPayload, Origin, Shop } from "../src/types";
import { topBrands } from "../src/utils/brands.ts";
import { ALL_PREFECTURES } from "../src/utils/prefectures.ts";
import { summarize as summarizeVisits } from "../src/utils/progress.ts";
import { brandCounts } from "../src/utils/shop-facts.ts";
import { fetchEdgeLocation } from "./lib/edge-location.ts";
import { registerDecideIekeiRamen } from "./tools/decide-iekei-ramen.ts";
import { registerFindNearbyIekeiRamen } from "./tools/find-nearby-iekei-ramen.ts";
import { registerForgetMyIekeiRamenVisits } from "./tools/forget-my-iekei-ramen-visits.ts";
import { registerGeocodePlace } from "./tools/geocode-place.ts";
import { registerSearchIekeiRamen } from "./tools/search-iekei-ramen.ts";
import { registerShowIekeiRamenMap } from "./tools/show-iekei-ramen-map.ts";
import { registerShowVisitedIekeiRamen } from "./tools/show-visited-iekei-ramen.ts";
import { registerStampIekeiRamen } from "./tools/stamp-iekei-ramen.ts";
import type { ServerDeps } from "./types/deps.ts";
import type { ToolContext } from "./types/tool-context.ts";
import { readEdgeLocation, readHostLocation } from "./utils/caller-location.ts";
import { localizeOrigin } from "./utils/place-label.ts";
import { withSameNamePlace } from "./utils/same-name-place.ts";
import { RESOURCE_URI, UI_RESOURCE_META } from "./utils/tool-metadata.ts";

const DEFAULT_SHOPS = withSameNamePlace(shopsData as Shop[]);

/** 本番既定データの選択肢は起動時に一度だけ導出する。 */
const DEFAULT_PREFECTURES = ALL_PREFECTURES.filter((p) =>
  DEFAULT_SHOPS.some((s) => s.prefecture === p),
);

export function createServer(deps: ServerDeps = {}): McpServer {
  const dataset = deps.shops ? withSameNamePlace(deps.shops) : DEFAULT_SHOPS;
  // 店名の券売機に並べるブランド（#144）。判定した結果の軒数が多い順。
  const brands = topBrands(dataset);
  const brandsInCity = brandCounts(dataset);
  /**
   * 座標を渡されなかったときの現在地。ホストが渡す位置 → 接続元からの推定の順
   * （後者は HTTP なら request.cf、stdio なら照会エンドポイント）。どちらも名前が
   * ローマ字で来るので、近い店の地名で日本語に置き換える（#150）。
   */
  const locateCaller = async (
    meta: Record<string, unknown> | undefined,
    req: Request | undefined,
  ): Promise<Origin | undefined> => {
    const found = readHostLocation(meta) ?? readEdgeLocation(req) ?? (await fetchEdgeLocation());
    return found && localizeOrigin(found, dataset);
  };
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
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => ({
      contents: [
        {
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: APP_HTML,
          _meta: UI_RESOURCE_META,
        },
      ],
    }),
  );

  /**
   * サインインしている人に渡す追加分。
   *
   * **匿名のときは何も足さない。** 空配列を入れると、UI から見て
   * 「サインインしていて 0 軒」と区別が付かなくなる。
   */
  const visitorExtras = async (): Promise<Partial<AppPayload>> => {
    if (!deps.visitor || !deps.visits) return {};
    const visited = await deps.visits.list(deps.visitor.id);
    return { visited, progress: summarizeVisits(dataset, visited) };
  };

  /**
   * payload の出口。**ここを通ると訪問情報が自動で乗る。**
   *
   * tool ごとに足すと、足し忘れた tool だけスタンプが出ない、という
   * 見つけにくい穴ができる（実際に最初そうなっていた）。
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
    ...payload,
    prefectures,
    brands,
    ...(extras ?? (await visitorExtras())),
  });

  const requireVisitor = () => {
    if (!deps.visitor || !deps.visits) throw new Error("サインインが必要です");
    return { visitor: deps.visitor, visits: deps.visits };
  };

  const ctx: ToolContext = {
    server,
    deps,
    dataset,
    brands,
    brandsInCity,
    prefectures,
    locateCaller,
    withVisitor,
    requireVisitor,
    visitorExtras,
  };
  // 並びは tools/list に出る順。変えるとモデルが見る一覧の順も変わる。
  registerSearchIekeiRamen(ctx);
  registerFindNearbyIekeiRamen(ctx);
  registerShowIekeiRamenMap(ctx);
  registerDecideIekeiRamen(ctx);
  registerGeocodePlace(ctx);
  registerStampIekeiRamen(ctx);
  registerShowVisitedIekeiRamen(ctx);
  registerForgetMyIekeiRamenVisits(ctx);

  server.server.setRequestHandler = setRequestHandler;
  return server;
}
