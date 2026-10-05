import { useMemo, type ReactNode } from "react";
import { metaParts, sameNameLabels } from "../lib/same-name";
import { CONFIDENCE, TASTES, type Shop } from "../lib/types";
import { formatDistance } from "../lib/geo";
import { openingHoursLabel } from "../lib/opening-hours";
import styles from "../mcp-app.module.css";

/*
 * 判定の段階は形でも分ける（色が見えにくい人に届くように）。
 * 塗り ■ ＞ 枠 □ ＞ 枠なし ？ の順に弱くなり、言い切れる度合いと揃う。
 */
const STAGE_CLASS = {
  confirmed: styles.stageConfirmed,
  likely: styles.stageLikely,
  candidate: styles.stageCandidate,
} as const;
const STAGE_MARK = { confirmed: "■", likely: "□", candidate: "？" } as const;

interface Props {
  shops: Shop[];
  /** 順位番号を出す（近い順のとき）。 */
  ranked?: boolean;
  selectedId?: string;
  onSelect?: (shop: Shop) => void;
  /**
   * 選択中のカードの直下に差し込むもの。
   * 一覧の上に置くと、選んだ瞬間に一覧全体が下にずれて次のカードを押せない。
   */
  detail?: ReactNode;
  emptyMessage?: string;
  /**
   * 訪問済みの店舗 ID。
   *
   * **匿名なら渡ってこない（undefined）。** 空集合と区別する必要はここには無いが、
   * 渡す側が「サインインしていない」を空集合に化けさせないよう、省略可にしてある。
   */
  visitedIds?: ReadonlySet<string>;
}

export function ShopList({
  shops,
  ranked,
  selectedId,
  onSelect,
  detail,
  emptyMessage,
  visitedIds,
}: Props) {
  /*
   * 同名の店が並ぶときだけ、どこの店かを名前の隣に出す。
   * **一覧の中身から決める。** 渡す側に任せると、出し忘れた一覧だけ
   * 同じ名前が並ぶ（「迷ったら」も「行った店」も同じ部品を使っている）。
   */
  const labels = useMemo(() => sameNameLabels(shops), [shops]);
  if (shops.length === 0) {
    return (
      <p className={styles.empty}>{emptyMessage ?? "条件に合う店舗が見つかりませんでした。"}</p>
    );
  }

  return (
    <ul className={styles.list}>
      {shops.map((shop, i) => (
        <li key={shop.id} className={selectedId === shop.id ? styles.listItemSelected : undefined}>
          <button
            type="button"
            className={`${styles.card} ${selectedId === shop.id ? styles.cardSelected : ""}`}
            onClick={() => onSelect?.(shop)}
            aria-current={selectedId === shop.id || undefined}
            /*
             * どの店かを名指しできるようにする。**店名は同一性ではない**——
             * 同じチェーンの別店舗は同じ名前で並ぶので、名前で突き合わせると
             * 別の店を同じ店と数える（実測: 「別の候補を見る」の前後を店名で
             * 比べていて、壱八家が 2 店入った途端に重複と判定された）。
             */
            data-shop-id={shop.id}
          >
            {ranked && <span className={styles.rank}>{i + 1}</span>}
            <span className={styles.cardBody}>
              <span className={styles.shopHead}>
                {/* 取り出す対象を名指しできるようにしておく（テストが店名だけを読む）。 */}
                <span className={styles.shopName} data-shop-name>
                  {shop.name}
                </span>
                {labels.has(shop.id) && (
                  <span className={styles.shopWhere} data-shop-where>
                    {labels.get(shop.id)?.text}
                  </span>
                )}
              </span>
              {/*
               * 判定の段階は一目で分かる位置に、常に出す（「家系」も含めて）。
               * 段階も味も推定なので、先頭に「推定」と添えてから並べる。
               */}
              <span className={styles.badges}>
                <span className={styles.estimate}>推定</span>
                <span
                  className={STAGE_CLASS[shop.confidence]}
                  title={CONFIDENCE[shop.confidence].description}
                  data-shop-stage={shop.confidence}
                >
                  <span aria-hidden="true">{STAGE_MARK[shop.confidence]}</span>
                  {CONFIDENCE[shop.confidence].label}
                </span>
                <span className={shop.taste === "unknown" ? styles.badgeMuted : styles.badge}>
                  {TASTES[shop.taste].label}
                </span>
                {shop.brand && <span className={styles.badgeMuted}>{shop.brand}</span>}
                {/* 行った印は特典の無いサブ機能なので、塗らずに控えめに添える。 */}
                {visitedIds?.has(shop.id) && <span className={styles.badgeVisited}>行った</span>}
              </span>
              {/*
               * 名前の隣に出した分は、住所の行で繰り返さない（同じ文字列が
               * 2 つ並ぶと壊れて見える）。**ただし出していない分は残す**——
               * 市区町村だけで見分けが付く店から町名まで消すと、持っている
               * 情報が画面から減る。判断は src/lib/same-name.ts にある。
               */}
              {/*
               * data-shop-meta-parts は、どの欄を出したかを区切って持つ。
               * **見た目は変わらない。** 文字列を目で突き合わせると、住所に
               * 市名が入っている店（「横浜市」/「横浜市磯子区上中里町669-1」）や、
               * 欄の中に空白がある店で誤判定するため、テストが欄ごとに
               * 比べられるようにしてある。
               */}
              <span
                className={styles.meta}
                data-shop-meta
                data-shop-meta-parts={metaParts(shop, labels.get(shop.id)).join("\u0000")}
              >
                {metaParts(shop, labels.get(shop.id)).join(" ")}
              </span>
              {shop.openingHours && (
                <span className={styles.meta}>営業 {openingHoursLabel(shop.openingHours)}</span>
              )}
            </span>
            {shop.distanceKm !== undefined && (
              <span className={styles.distance}>{formatDistance(shop.distanceKm)}</span>
            )}
          </button>
          {selectedId === shop.id && detail}
        </li>
      ))}
    </ul>
  );
}
