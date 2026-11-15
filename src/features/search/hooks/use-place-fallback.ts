import { useState } from "react";

/**
 * 「店名で」が 0 軒のとき、入れた語を地名として近くを探す口（#401）。
 *
 * 「横浜駅」「よしむらや」は店名・ブランド・市区町村のどれにも当たらず 0 軒になり、報告の案内だけが
 * 出て行き止まりだった。同じ「横浜駅」でも「現在地から」の地名なら近い店が出る。0 軒の表示から
 * その検索へ渡す。地名でもなければ、見つからなかったと書いて、報告の案内（下）へ任せる。
 *
 * 探す語が無い・地名の検索が無いときは undefined（今までどおりの空の表示）。
 */
export function usePlaceFallback(
  query: string | undefined,
  searchPlace: ((query: string) => Promise<unknown>) | undefined,
) {
  const [status, setStatus] = useState<string>();
  const q = query?.trim();
  if (!q || !searchPlace) return undefined;
  return {
    message: `「${q}」に当たる店名・ブランドはありませんでした。駅名や地名なら、その近くを探せます。`,
    /*
     * 探している・見つからなかったことは、待ち受けの読み上げ領域に出す（Codex の指摘）。焦点は押した
     * 釦に残り、payload も変わらないので、本文を書き換えるだけでは読み上げに伝わらない。
     * 領域は最初から置く（空の文字列）。出てから中身を入れないと読まれない。
     */
    status: status ?? "",
    action: {
      label: `「${q}」の近くを探す`,
      onClick: () => {
        setStatus(`「${q}」の場所を探しています…`);
        // 見つかれば「現在地から」の結果に替わる（この表示ごと消える）。
        searchPlace(q).then(
          (hit) => {
            if (!hit) setStatus(`「${q}」という地名は見つかりませんでした。`);
          },
          // 理由（連打止め・地名の検索の不調）はサーバーの文をそのまま出す。
          (error: unknown) => setStatus(error instanceof Error ? error.message : String(error)),
        );
      },
    },
  };
}
