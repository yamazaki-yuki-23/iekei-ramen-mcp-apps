import type { Shop } from "./types";

/**
 * 同じ名前の店が並ぶときに、名前の隣へ足す一言。
 *
 * **チェーンの別店舗は、店名だけ見ると同じ店に見える。** 実データでは東京都に
 * 町田商店が 14 店あり（最短 517m・最長 38.6km）、一覧では同じ文字列が並ぶ。
 * 重複登録ではないのに重複に見えるので、どこの店かを名前の隣に出す。
 *
 * **並んでいるものの中で必要なときだけ出す。** 1 軒しか出ていない名前に
 * 「新宿区」と足しても、読む手間が増えるだけで何も区別しない。
 */
export function sameNameLabels(shops: Shop[]): Map<string, string> {
  const byName = new Map<string, Shop[]>();
  for (const shop of shops) {
    const group = byName.get(shop.name) ?? [];
    group.push(shop);
    byName.set(shop.name, group);
  }

  const labels = new Map<string, string>();
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    /*
     * 市区町村で足りるなら市区町村だけ。同じ市に 2 店あるとき（町田市の
     * 町田商店）は町名まで降りる。**最初から町名まで出さない**のは、
     * 読むのは人で、長い文字列が並ぶほど見分けにくくなるため。
     */
    const cities = new Set(group.map((shop) => shop.city ?? ""));
    const fine = cities.size < group.length;
    for (const shop of group) {
      const label = fine
        ? [shop.city, shop.address].filter(Boolean).join(" ")
        : (shop.city ?? shop.address ?? "");
      // 出すものが無いなら黙っている。空の括弧を出さない。
      if (label) labels.set(shop.id, label);
    }
  }
  return labels;
}
