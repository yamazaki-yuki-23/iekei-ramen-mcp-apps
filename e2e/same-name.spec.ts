/**
 * 同名の店の見分け。
 *
 * **重複登録ではなく、チェーンの別店舗**が同じ文字列で並ぶ。実データでは
 * 東京都に町田商店が 14 店ある（最短 517m・最長 38.6km）。
 */
import { expect, test, type FrameLocator } from "@playwright/test";
import { callTool, shopCards, shopName, shopWhere, waitForApp } from "./helpers";

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
  for (const [, rows] of repeated) {
    const labels: string[] = [];
    for (const index of rows) {
      const where = shopWhere(cards.nth(index));
      await expect(where).toHaveCount(1);
      labels.push((await where.innerText()).trim());
    }
    // 互いに違う地名になっていること（同じでは見分けが付かない）。
    expect(new Set(labels).size, `同名のカードが同じ地名のまま: ${labels.join(" / ")}`).toBe(
      labels.length,
    );
  }
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
