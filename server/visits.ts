/**
 * 訪問スタンプの記録。
 *
 * **D1 を直接触るのはここだけ。** tool 側は「誰が・どの店に」だけを知っていれば
 * よく、SQL を知る必要はない。テストでは同じ形の偽物に差し替える。
 */
export interface VisitStore {
  /** その人が行った店の ID。 */
  list(visitorId: string): Promise<string[]>;
  /** 押す・外す。戻り値は押したあとの状態。 */
  set(visitorId: string, shopId: string, visited: boolean): Promise<boolean>;
  /** その人の記録を全部消す。 */
  clear(visitorId: string): Promise<void>;
}

/** D1 を使う実装。 */
export function d1Visits(db: D1Database): VisitStore {
  return {
    async list(visitorId) {
      const { results } = await db
        .prepare("SELECT shop_id FROM visits WHERE user_id = ?")
        .bind(visitorId)
        .all<{ shop_id: string }>();
      return results.map((row) => row.shop_id);
    },

    async set(visitorId, shopId, visited) {
      if (visited) {
        /*
         * 押し直しても壊れないようにする（同じ店を 2 回押す操作はふつうに起きる）。
         * **日付は上書きしない**——最初に行った日のほうが意味がある。
         */
        await db
          .prepare(
            "INSERT INTO visits (user_id, shop_id, visited_at) VALUES (?, ?, ?)" +
              " ON CONFLICT (user_id, shop_id) DO NOTHING",
          )
          .bind(visitorId, shopId, new Date().toISOString())
          .run();
      } else {
        await db
          .prepare("DELETE FROM visits WHERE user_id = ? AND shop_id = ?")
          .bind(visitorId, shopId)
          .run();
      }
      return visited;
    },

    async clear(visitorId) {
      await db.prepare("DELETE FROM visits WHERE user_id = ?").bind(visitorId).run();
    },
  };
}

/** テスト用。D1 を立てずに tool の筋を確かめるための、同じ形の偽物。 */
export function memoryVisits(seed: Record<string, string[]> = {}): VisitStore {
  const rows = new Map<string, Set<string>>(
    Object.entries(seed).map(([id, shops]) => [id, new Set(shops)]),
  );
  const of = (visitorId: string) => {
    const set = rows.get(visitorId) ?? new Set<string>();
    rows.set(visitorId, set);
    return set;
  };
  return {
    list: async (visitorId) => [...of(visitorId)],
    set: async (visitorId, shopId, visited) => {
      if (visited) of(visitorId).add(shopId);
      else of(visitorId).delete(shopId);
      return visited;
    },
    clear: async (visitorId) => {
      rows.delete(visitorId);
    },
  };
}
