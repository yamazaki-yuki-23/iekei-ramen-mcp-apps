import { ALL_PREFECTURES } from "./prefectures";

/**
 * 条件の無い入口は「迷ったら」（券売機、#144）。位置の許可は求めず、接続元から推定した
 * 地域の 3 軒を出す（near: "auto"、#152）。約束「近くに、まだ知らない家系がある。」の下に
 * 遠くの店を並べないため。推定できなければ全国から。
 */
const HOME = { name: "decide-iekei-ramen", arguments: { near: "auto" } };

/** 静的ページの検索条件だけを受け取る。任意のtoolや座標はURLから実行しない。 */
export function webEntry(search: string) {
  const params = new URLSearchParams(search);
  const pref = params.get("prefecture");
  const keyword = params.get("keyword")?.trim();
  if (
    (pref && !ALL_PREFECTURES.some((value) => value === pref)) ||
    (keyword && keyword.length > 100)
  )
    return HOME;
  /*
   * 県だけなら、その県の券売機（「迷ったら」の 3 軒）で開く（#152）。都道府県のページの
   * 「〇〇県で発券する」の行き先。市区町村・店名が付くときは一覧（検索）で開く。
   */
  if (pref && !keyword) return { name: "decide-iekei-ramen", arguments: { prefecture: pref } };
  return keyword
    ? {
        name: "search-iekei-ramen",
        arguments: { ...(pref ? { prefecture: pref } : {}), keyword },
      }
    : HOME;
}
