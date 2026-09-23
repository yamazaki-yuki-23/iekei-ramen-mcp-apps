/**
 * 「迷ったら」モードの候補選び。
 *
 * 558 件の一覧は選択肢地獄で、人は理由の無い長い一覧からは決められない。
 * ここで 3 軒まで落として、あとはモデルに 1 軒推させる。
 *
 * **勝手な「おすすめ順」を作らないこと。** このデータには評価も混雑も口コミも
 * 無いので、質の順位は付けられない。並べていいのは実際に持っている情報だけ
 * （家系判定の段階・距離・営業時間の有無）で、それ以外の軸を足すと、
 * 根拠の無い順位を UI が事実として見せることになる。
 *
 * 乱数も使わない。「引き直す」は次の 3 軒であって、シャッフルではない。
 * 決定的なので、同じ条件なら毎回同じ並びになり、テストもできる。
 */
import { distanceKm, originLabel } from "./geo";
import type { DecideInfo, Origin, Shop } from "./types";

/** 1 巡で見せる軒数。3 を超えると、また選べなくなる。 */
export const SHORTLIST_SIZE = 3;

export interface Shortlist extends DecideInfo {
  /** 今回見せる 3 軒（母数が足りなければそれ未満）。 */
  picks: Shop[];
}

/**
 * 候補の母集団。
 *
 * 「家系か未判定」は店名だけが手がかりで、家系とは限らない。「迷ったら」モードで
 * 最初に推すには弱いので、まず外す。外した結果 3 軒に届かないときだけ戻す。
 * 「候補が無い」より「確かさは落ちるが候補はある」の方が使えるため。
 */
function buildPool(shops: Shop[]): { pool: Shop[]; widened: boolean } {
  const sure = shops.filter((s) => s.confidence !== "candidate");
  if (sure.length >= SHORTLIST_SIZE) return { pool: sure, widened: false };
  /*
   * 3 軒に届かないので戻すが、戻す相手がいるとは限らない（確実な 1 軒しか
   * 無い県など）。軒数だけで言い切ると、1 軒も足していないのに「家系か未判定も
   * 含めて」と名乗り、UI とモデルの両方に嘘の但し書きが出る。実際に足したかで決める。
   */
  return { pool: shops, widened: shops.length > sure.length };
}

/** 家系判定の段階を並べ替え用の数値にする。小さいほど確か。 */
const tierOf = (shop: Shop): number =>
  shop.confidence === "confirmed" ? 0 : shop.confidence === "likely" ? 1 : 2;

/**
 * 候補を並べる。
 *
 * 基準地点があるなら近い順。「今から行く店を決める」ので、距離が最優先になる。
 * 判定の段階は同距離のときの決め手にしか使わない（30km 先の確実な 1 軒より、
 * 300m 先の可能性のある 1 軒を先に見せたい）。
 *
 * 基準地点が無いときは営業時間が分かる店から。558 件中 107 件にしか入って
 * いないが、入っていれば「今日行けるか」を自分で判断できる。
 */
function orderCandidates(shops: Shop[], origin?: Origin): Shop[] {
  const withDistance = origin
    ? shops.map((s) => ({
        ...s,
        distanceKm: Number(distanceKm(origin.lat, origin.lon, s.lat, s.lon).toFixed(3)),
      }))
    : shops;

  return withDistance.toSorted((a, b) => {
    if (origin) {
      const d = (a.distanceKm ?? 0) - (b.distanceKm ?? 0);
      if (d !== 0) return d;
    } else {
      const hours = Number(!a.openingHours) - Number(!b.openingHours);
      if (hours !== 0) return hours;
    }
    const tier = tierOf(a) - tierOf(b);
    if (tier !== 0) return tier;
    // 並びを一意にする。ここが無いと、同点の店の順番が実行ごとに揺れる。
    return a.name.localeCompare(b.name, "ja") || a.id.localeCompare(b.id);
  });
}

/**
 * 条件に合う店から 3 軒を取り出す。
 *
 * round は 0 始まりで、1 増えるごとに次の 3 軒へ進む。最後まで行ったら
 * 先頭へ戻す。行き止まりにすると「引き直す」が押せなくなるだけで、
 * ユーザーには何の得も無い。
 */
export function shortlist(
  shops: Shop[],
  opts: { origin?: Origin; round?: number } = {},
): Shortlist {
  const { pool, widened } = buildPool(shops);
  const ordered = orderCandidates(pool, opts.origin);
  const rounds = Math.max(1, Math.ceil(ordered.length / SHORTLIST_SIZE));
  // 負の値や範囲外を渡されても壊さない。UI からもモデルからも呼ばれる。
  const round =
    ordered.length === 0 ? 0 : ((Math.trunc(opts.round ?? 0) % rounds) + rounds) % rounds;

  return {
    picks: ordered.slice(round * SHORTLIST_SIZE, round * SHORTLIST_SIZE + SHORTLIST_SIZE),
    round,
    rounds,
    poolTotal: ordered.length,
    basis: opts.origin ? "distance" : "hours",
    widened,
  };
}

/**
 * なぜこの 3 軒なのかを 1 文で。
 *
 * **UI とモデルに同じ文を見せる。** 別々に書くと、画面の説明と会話の説明が
 * ずれて、どちらが本当か分からなくなる。
 */
export function describeBasis(
  info: DecideInfo,
  shown: number,
  origin?: Origin,
  keyword?: string,
): string {
  const how =
    info.basis === "distance"
      ? `${origin ? originLabel(origin) : "基準地点"}から近い順`
      : "営業時間が分かる店から順";
  const scope = info.widened ? "「家系か未判定」も含めて" : "家系と分かっている店にしぼって";
  // 効いている絞り込みは必ず書く。書かないと、候補が減っていても理由が
  // どこにも出ない（キーワード欄はこのモードに無い）。
  const filtered = keyword ? `「${keyword}」に合う` : "";
  return `${scope}${filtered} ${info.poolTotal} 軒を${how}に並べ、${info.round + 1} 巡目の ${shown} 軒です。`;
}
