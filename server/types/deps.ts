import type { Shop } from "../../src/types";
import type { VisitStore } from "../lib/visits.ts";

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
