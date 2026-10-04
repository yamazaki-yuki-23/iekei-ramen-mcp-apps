import { ALL_PREFECTURES } from "./prefectures";

/** 静的ページの検索条件だけを受け取る。任意のtoolや座標はURLから実行しない。 */
export function webEntry(search: string) {
  const params = new URLSearchParams(search);
  const pref = params.get("prefecture");
  const keyword = params.get("keyword")?.trim();
  if (
    (pref && !ALL_PREFECTURES.some((value) => value === pref)) ||
    (keyword && keyword.length > 100)
  )
    return { name: "decide-iekei-ramen", arguments: {} };
  const args = {
    ...(pref ? { prefecture: pref } : {}),
    ...(keyword ? { keyword } : {}),
  };
  return Object.keys(args).length
    ? { name: "search-iekei-ramen", arguments: args }
    : { name: "decide-iekei-ramen", arguments: {} };
}
