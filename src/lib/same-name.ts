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
export interface SameNameLabel {
  /** 名前の隣に出す文字列。 */
  text: string;
  /**
   * その文字列を作るのに使った欄。
   *
   * **文字列を見比べて判断しない。** 「府中市」に「府中」が含まれるような
   * ときに、出していない町名まで住所の行から消えてしまう。どの欄を使ったかを
   * そのまま持ち回れば、取り違えようがない。
   */
  used: Array<"city" | "address">;
}

export function sameNameLabels(shops: Shop[]): Map<string, SameNameLabel> {
  const byName = new Map<string, Shop[]>();
  for (const shop of shops) {
    const group = byName.get(shop.name) ?? [];
    group.push(shop);
    byName.set(shop.name, group);
  }

  const labels = new Map<string, SameNameLabel>();
  for (const group of byName.values()) {
    if (group.length < 2) continue;

    /*
     * その市区町村が、この名前の中で 1 軒だけかどうか。
     *
     * **見分けが付くときだけ出す。** 同じ市に 2 軒あるなら、市区町村を出しても
     * 2 枚に同じ文字が並ぶだけで何も分からない。出さなければ住所の行が
     * 丸ごと残る（町名まで出る）ので、そちらで見分けが付く。
     */
    const perCity = new Map<string, number>();
    for (const shop of group) {
      if (shop.city) perCity.set(shop.city, (perCity.get(shop.city) ?? 0) + 1);
    }

    for (const shop of group) {
      /*
       * **出すのは市区町村まで。** 町名や番地まで載せると 30 文字を超えることが
       * あり（実データの最長は「西区高島2丁目19-12-19-12 スカイビル10F」）、
       * 横 1 行に収める版面で切れる。切れた先は住所の行にも無い。
       *
       * 市区町村が無い店にも出さない。町名で代えると同じ問題が起きる。
       */
      if (!shop.city || perCity.get(shop.city) !== 1) continue;
      labels.set(shop.id, { text: shop.city, used: ["city"] });
    }
  }
  return labels;
}

/**
 * 住所の行に出すもの。
 *
 * **名前の隣に出した分だけを外す。** 全部落とすと、市区町村だけで見分けが
 * 付いた店（「大和市」「鎌倉市」）から町名まで消えてしまい、持っている情報が
 * 画面から減る。逆に外さないと同じ文字列が 2 つ並ぶ。
 */
export function metaParts(shop: Shop, label?: SameNameLabel): string[] {
  const shown = new Set(label?.used ?? []);
  return [
    shop.prefecture,
    shown.has("city") ? undefined : shop.city,
    shown.has("address") ? undefined : shop.address,
  ].filter((part): part is string => Boolean(part));
}
