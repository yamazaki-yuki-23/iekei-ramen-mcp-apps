import type { Shop } from "../types";

/** 店名だけを出す所の名前。同じ店名の店には町名を添える（#307。「町田商店（南中丸）」）。 */
export function shopName(shop: Pick<Shop, "name" | "place">): string {
  return shop.place ? `${shop.name}（${shop.place}）` : shop.name;
}
