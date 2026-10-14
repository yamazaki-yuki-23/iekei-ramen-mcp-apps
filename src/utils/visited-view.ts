/**
 * 「行った店」の画面の出し分け。
 *
 * **記録の件数と、画面に出せる店の数はずれる。** 記録は店舗 ID で持っているので、
 * データを取り直して店が消えると、記録は残ったまま一覧から落ちる（サーバーは
 * 実在する店だけを返し、制覇率もその分は数えない）。
 *
 * このずれを「0 件」とひとまとめにすると、**記録が残っているのに「まだ記録が
 * ありません」と出て、消す導線まで消える**——自分の記録を自分で消せなくなる。
 * 判断を 1 か所に集めて、画面側が数え方を選べないようにしてある。
 */
export interface VisitedView {
  /** 記録を消す導線を出すか。**見えている店ではなく、記録の有無で決める。** */
  showForget: boolean;
  /** 一覧が空のときに出す文。出す必要が無ければ undefined。 */
  empty?: string;
}

const NOTHING_YET = "まだ記録がありません。店を選んで「行った」を押すと、ここに並びます。";
/**
 * 記録はあるのに出せる店が無いとき。**黙って 0 件にしない。**
 *
 * **モデルにも同じ文を渡す**（server.ts が使う）。別々に書くと、画面には
 * 「記録は残っている」と出ているのにモデルは「1 軒も記録がない」と話す。
 */
export const RECORDS_WITHOUT_SHOPS =
  "記録した店が、いまの店舗データに見当たりません。店舗データが入れ替わると起きます。記録は残っているので、下の釦から消せます。";

export function visitedView(shownShops: number, recordCount: number): VisitedView {
  if (recordCount === 0) return { showForget: false, empty: NOTHING_YET };
  if (shownShops === 0) return { showForget: true, empty: RECORDS_WITHOUT_SHOPS };
  return { showForget: true };
}
