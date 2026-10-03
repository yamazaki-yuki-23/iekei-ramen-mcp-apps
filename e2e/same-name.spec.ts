/**
 * 同名の店の見分け。
 *
 * **重複登録ではなく、チェーンの別店舗**が同じ文字列で並ぶ。実データでは
 * 東京都に町田商店が 14 店ある（最短 517m・最長 38.6km）。
 */
import { expect, type FrameLocator } from "@playwright/test";
import { test } from "./fixtures";
import { callTool, shopCards, shopMetaFields, shopName, shopWhere, waitForApp } from "./helpers";

/**
 * 一覧の店名を読み、名前ごとに何番目のカードかをまとめる。
 *
 * **名前は完全一致で見る。** 部分一致で選ぶと、他の店名に含まれる短い名前まで
 * 巻き込んで、地名の付かないカードを掴んでしまう（最初に書いたテストが
 * そうなっていた）。
 */
async function cardsByName(app: FrameLocator): Promise<Map<string, number[]>> {
  const cards = shopCards(app);
  const count = await cards.count();
  const byName = new Map<string, number[]>();
  for (let index = 0; index < count; index += 1) {
    const name = await shopName(cards.nth(index));
    byName.set(name, [...(byName.get(name) ?? []), index]);
  }
  return byName;
}

test("同じ名前が並ぶときは、どこの店かが名前の隣に出る", async ({ page }) => {
  const app = await callTool(page, "search-iekei-ramen", { prefecture: "東京都" });
  await waitForApp(app);

  const byName = await cardsByName(app);
  const repeated = [...byName.entries()].filter(([, rows]) => rows.length > 1);
  /*
   * **同名が出ていることを先に確かめる。** 出ていない一覧で「見分けが付く」と
   * 言っても何も見ていない（データが変わって同名が消えたら、ここで落ちて気付ける）。
   */
  expect(repeated.length, "同名の店が一覧に出ていない").toBeGreaterThan(0);

  const cards = shopCards(app);
  let labelled = 0;
  for (const [, rows] of repeated) {
    const texts: string[] = [];
    for (const index of rows) {
      /*
       * **地名が付かない店もある。** 市区町村が取れなかった店には出さない
       * （町名で代えると長くなって、横 1 行の版面ではみ出すため）。
       * その店は住所の行に町名が残るので、カードとしては見分けが付く。
       */
      labelled += await shopWhere(cards.nth(index)).count();
      texts.push((await cards.nth(index).innerText()).trim());
    }
    /*
     * **地名どうしが違うことまでは求めない。** 同じ市に 2 店あるときは同じ
     * 市区町村が並び、そこから先（町名）は住所の行が受け持つ。カードとして
     * 見分けが付いていればよい。
     */
    expect(new Set(texts).size, `同名のカードが同じ中身のまま`).toBe(texts.length);
  }

  // いまのデータは 558 件すべてが市区町村を持つので、1 件も出ていなければ壊れている。
  expect(labelled, "地名が 1 件も出ていない").toBeGreaterThan(0);
});

test("名前が重ならない店には、余計な地名を出さない", async ({ page }) => {
  /*
   * 1 軒しか出ていない名前に「新宿区」と足しても、読む手間が増えるだけ。
   * **必要なときだけ出す**ことを固定しておく。
   */
  const app = await callTool(page, "search-iekei-ramen", { prefecture: "東京都" });
  await waitForApp(app);

  const byName = await cardsByName(app);
  const alone = [...byName.entries()].filter(([, rows]) => rows.length === 1);
  expect(alone.length, "名前が重ならない店が 1 軒も出ていない").toBeGreaterThan(0);

  const cards = shopCards(app);
  for (const [, [index]] of alone) {
    await expect(shopWhere(cards.nth(index))).toHaveCount(0);
  }
});

test("名前の隣に出した地名を、住所の行で繰り返さない", async ({ page }) => {
  /*
   * 同じ文字列が並ぶと壊れて見える。実際、直す前は
   * 「とんこつラーメン たかさご家 横浜市 野毛町二丁目 神奈川県 横浜市 野毛町二丁目」
   * と出ていた（スクリーンショットを撮り直して気付いた）。
   */
  const app = await callTool(page, "search-iekei-ramen", { prefecture: "神奈川県" });
  await waitForApp(app);

  const byName = await cardsByName(app);
  const repeated = [...byName.entries()].filter(([, rows]) => rows.length > 1);
  expect(repeated.length, "同名の店が一覧に出ていない").toBeGreaterThan(0);

  const cards = shopCards(app);
  for (const [, rows] of repeated) {
    for (const index of rows) {
      const card = cards.nth(index);
      // 市区町村が無い店には地名を出さない。その店はここで見るものが無い。
      if ((await shopWhere(card).count()) === 0) continue;
      const where = (await shopWhere(card).innerText()).trim();
      /*
       * **欄ごとに比べる。** 文字列の部分一致で見ると、住所に市名が入っている
       * 店（「横浜市」と「横浜市磯子区上中里町669-1」）を「重複」と誤判定する。
       */
      const fields = await shopMetaFields(card);
      expect(fields, `地名が住所の行にも出ている: ${where}`).not.toContain(where);
    }
  }
});
