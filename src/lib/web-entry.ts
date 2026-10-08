import { ALL_PREFECTURES } from "./prefectures";

/**
 * 条件の無い入口は「迷ったら」（券売機、#144）。位置を求めずに全国の 3 軒を出しておき、
 * 券売機で選び直して発券する。
 */
const HOME = { name: "decide-iekei-ramen", arguments: {} };

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
