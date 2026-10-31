import type { Shop } from "../../src/types/index.ts";

/**
 * 住所の先頭の語から町名を取る（#307）。「守山区苗代一丁目14-4」→「苗代」、「一番町3丁目」→「一番町」、
 * 「北15条西4」→「北15条」。
 * 区・郡と、丁目・番地を外す。番地しか無い住所（「3-11」）からは何も取らない。
 */
export function townOf(address: string | undefined): string | undefined {
  const head = address?.split(/[\s　]/)[0];
  if (!head) return undefined;
  const town = head
    .replace(/^.+?[区郡](?=.)/, "")
    .replace(/[一二三四五六七八九十]+丁目.*$/, "")
    // 最初の数字の手前まで。札幌の「北15条西4」は「北15条」までが町名なので、条の数字は残す。
    .match(/^[^0-9０-９]*(?:[0-9０-９]+条)?/)?.[0];
  return town || undefined;
}

/**
 * 同じ店名が全データで 2 軒以上ある店に、店名に添える地名（`place`）を付ける（#307）。
 *
 * 地図のピンの札・まわる店などは店名だけを出すので、「町田商店」が 57 軒あるとどれか分からない。
 * 町名で見分けられればそれを、同じ店名の中で町名が重なれば市区町村を、どちらでも
 * 見分けられなければ何も付けない（住所の文字を使い、推測の語は足さない）。
 */
export function withSameNamePlace(shops: Shop[]): Shop[] {
  const byName = Map.groupBy(shops, (shop) => shop.name);
  const places = new Map<string, string>();
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const towns = Map.groupBy(group, (shop) => townOf(shop.address));
    const cities = Map.groupBy(group, (shop) => shop.city);
    for (const shop of group) {
      const town = townOf(shop.address);
      const place =
        town && towns.get(town)?.length === 1
          ? town
          : shop.city && cities.get(shop.city)?.length === 1
            ? shop.city
            : undefined;
      if (place) places.set(shop.id, place);
    }
  }
  return shops.map((shop) => {
    const place = places.get(shop.id);
    return place ? { ...shop, place } : shop;
  });
}
