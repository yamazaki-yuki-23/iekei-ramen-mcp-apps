import { ALL_PREFECTURES } from "./prefectures";

/**
 * 条件の無い入口は地図（#125）。位置を許可しなくても、全国の店がすぐ見える。
 * 「迷ったら」は最初の画面の入口から入る。
 */
const HOME = { name: "show-iekei-ramen-map", arguments: {} };

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
  const args = {
    ...(pref ? { prefecture: pref } : {}),
    ...(keyword ? { keyword } : {}),
  };
  return Object.keys(args).length ? { name: "search-iekei-ramen", arguments: args } : HOME;
}
