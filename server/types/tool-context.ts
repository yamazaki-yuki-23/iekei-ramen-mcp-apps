import type { McpServer } from "@modelcontextprotocol/server";
import type { BrandCount } from "../../src/utils/brands.ts";
import type { AppPayload, Origin, Shop } from "../../src/types";
import type { ServerDeps } from "./deps.ts";

/**
 * tool を登録するときに渡す材料。`createServer` が 1 回だけ作り、どの tool も同じものを使う
 * （データ・都道府県・ブランドを tool ごとに導き直さない。payload の出口も 1 つにする）。
 */
export interface ToolContext {
  server: McpServer;
  deps: ServerDeps;
  /** 店舗データ。`deps.shops` があればそれ、無ければ同梱の実店舗データ。 */
  dataset: Shop[];
  /** 店名の券売機に並べるブランド（#144）。判定した結果の軒数が多い順。 */
  brands: BrandCount[];
  /** 市区町村ごとのブランドの軒数。家系マッチのレア札の理由に使う（#166）。 */
  brandsInCity: Map<string, number>;
  /** データにある都道府県。 */
  prefectures: string[];
  /**
   * 座標を渡されなかったときの現在地。ホストが渡す位置 → 接続元からの推定の順
   * （後者は HTTP なら request.cf、stdio なら照会エンドポイント）。
   */
  locateCaller: (
    meta: Record<string, unknown> | undefined,
    req: Request | undefined,
  ) => Promise<Origin | undefined>;
  /**
   * payload の出口。**ここを通ると訪問情報が自動で乗る。** 読んだ記録があるなら
   * `extras` で渡す（中でもう一度読むと、1 つの応答に 2 つの時点が混ざる）。
   */
  withVisitor: (
    payload: Omit<AppPayload, "prefectures">,
    extras?: Partial<AppPayload>,
  ) => Promise<Record<string, unknown>>;
  /** サインインしている人と記録の置き場。サインインしていなければ投げる。 */
  requireVisitor: () => {
    visitor: { id: string };
    visits: NonNullable<ServerDeps["visits"]>;
  };
  /** サインインしている人の記録と制覇率。匿名なら空。 */
  visitorExtras: () => Promise<Partial<AppPayload>>;
}
