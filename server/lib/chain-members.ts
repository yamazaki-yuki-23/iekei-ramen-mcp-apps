import verified from "../../data/verified.json" with { type: "json" };
import type { Shop } from "../../src/types";
import { recordShopId } from "../../src/lib/record-id.ts";

/**
 * 店の ID → 公式の情報で確かめた系列名（data/verified.json の basis: chain）。閉じた記録は使わない。
 */
const CHAIN_OF: ReadonlyMap<string, string> = new Map(
  (verified as Array<{ status: string; basis: string; chain?: string; id?: string }>)
    .filter((record) => record.status === "open" && record.basis === "chain" && record.chain)
    .map((record) => [recordShopId(record), record.chain as string]),
);

/**
 * 確かめた系列名を店に付ける（#368）。
 *
 * 系列のページ（/chain/…）はこの記録で店を集める。キーワードの照合が店名・ブランドの文字だけだと、
 * 名前の違う系列の店（吉村家の厚木家、町田商店の志木商店など）が「近くの〇〇を出す」から漏れ、
 * ページに載っている店と食い違う。照合は `filterShops` が `chain` も見る。
 */
export const withChain = (shops: Shop[]): Shop[] =>
  shops.map((shop) => {
    const chain = CHAIN_OF.get(shop.id);
    return chain ? { ...shop, chain } : shop;
  });
