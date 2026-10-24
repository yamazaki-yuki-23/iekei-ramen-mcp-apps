import { memo, useMemo, type CSSProperties, type ReactNode } from "react";
import { metaParts, sameNameLabels, type SameNameLabel } from "../utils/same-name";
import { type Shop } from "../../../types";
import { formatDistance } from "../../../utils/geo";
import { openingHoursLabel } from "../../../utils/opening-hours";
import { PIN_COLORS, TASTE_WORDS } from "../utils/taste-marks";
import styles from "../styles/search.module.css";
import { StateNote } from "./StateNote";
import { SELECTED_SHOP_ID } from "./SelectedShop";

interface Props {
  shops: Shop[];
  /** 順位番号を出す（近い順のとき）。 */
  ranked?: boolean;
  /**
   * 「迷ったら」の 3 軒を食券の形で出す。番号は半券に載る表示順で、
   * 順位ではない（おすすめ順に見せない）。
   */
  ticket?: boolean;
  /**
   * 半券に書くもの。番号（表示順）か、基準地点からの直線距離（現在地から、#144）。
   * 距離のときは右端の距離を出さない（半券と 2 か所に同じ数字が並ぶ）。
   */
  stub?: "number" | "distance";
  selectedId?: string;
  onSelect?: (shop: Shop) => void;
  /**
   * 選択中のカードの直下に差し込むもの。
   * 一覧の上に置くと、選んだ瞬間に一覧全体が下にずれて次のカードを押せない。
   */
  detail?: ReactNode;
  emptyMessage?: string;
  /** 空のときに添える案内。検索の空なら報告の口、行った店の空なら無し。 */
  emptyHint?: string;
  /**
   * 訪問済みの店舗 ID。
   *
   * **匿名なら渡ってこない（undefined）。** 空集合と区別する必要はここには無いが、
   * 渡す側が「サインインしていない」を空集合に化けさせないよう、省略可にしてある。
   */
  visitedIds?: ReadonlySet<string>;
}

/** 半券（または順位）の中身。距離のときは「直線」と添えて、道のりと読ませない。 */
function RankStub({
  shop,
  index,
  stub,
}: {
  shop: Shop;
  index: number;
  stub: "number" | "distance";
}) {
  if (stub === "distance" && shop.distanceKm !== undefined) {
    return (
      <span className={styles.rankDistance}>
        {formatDistance(shop.distanceKm)}
        <small>直線</small>
      </span>
    );
  }
  return <span className={styles.rank}>{index + 1}</span>;
}

/**
 * 食券 1 枚。**memo で包み、変わった札だけ描き直す**（#157）。キーワードの下書きは外側の
 * state なので、1 打鍵ごとに一覧全体が描き直され、最大 200 枚の札を作り直していた。
 * 受け取るものは札ごとの値だけにする（onSelect は外側の setSelected で変わらない）。
 */
/** 1 枚目の食券の data-focus-key。use-keyboard-focus-return.ts はこの名前で焦点の戻り先を探す。 */
export const FIRST_TICKET_KEY = "first-ticket";

const ShopCard = memo(function ShopCard({
  shop,
  index,
  selected,
  visited,
  label,
  ranked,
  stub,
  expandable,
  onSelect,
}: {
  shop: Shop;
  index: number;
  selected: boolean;
  visited: boolean;
  label?: SameNameLabel;
  ranked?: boolean;
  stub: "number" | "distance";
  /** 選ぶと下に詳細が開く一覧か。開閉を読み上げで分かるようにする（#212）。 */
  expandable?: boolean;
  onSelect?: (shop: Shop) => void;
}) {
  const meta = metaParts(shop, label);
  return (
    <button
      type="button"
      className={styles.card}
      onClick={() => onSelect?.(shop)}
      aria-current={selected || undefined}
      aria-expanded={expandable ? selected : undefined}
      aria-controls={expandable && selected ? SELECTED_SHOP_ID : undefined}
      /*
       * どの店かを名指しできるようにする。**店名は同一性ではない**——
       * 同じチェーンの別店舗は同じ名前で並ぶので、名前で突き合わせると
       * 別の店を同じ店と数える（実測: 「次の 3 軒を見る」の前後を店名で
       * 比べていて、壱八家が 2 店入った途端に重複と判定された）。
       */
      data-shop-id={shop.id}
      // 発券したあと、キーボードの焦点を 1 枚目へ渡す（#204。TicketMachine の「この条件で 3 軒を出す」と同じ名前）。
      data-focus-key={index === 0 ? FIRST_TICKET_KEY : undefined}
    >
      {ranked && <RankStub shop={shop} index={index} stub={stub} />}
      <span className={styles.cardBody}>
        <span className={styles.shopHead}>
          {/* 取り出す対象を名指しできるようにしておく（テストが店名だけを読む）。 */}
          <span className={styles.shopName} data-shop-name>
            {shop.name}
          </span>
          {label && (
            <span className={styles.shopWhere} data-shop-where>
              {label.text}
            </span>
          )}
        </span>
        {/*
         * 判定の段階（家系か・可能性か・未判定か）はカードに出さない（#144）。
         * 家系のアプリで「家系」と並べても情報にならない。誤りの可能性は画面下の
         * 但し書きで全モード共通に伝え、報告で直す。
         */}
        <span className={styles.badges}>
          <ShopFacts shop={shop} />
          {/* 行った印は特典の無いサブ機能なので、塗らずに控えめに添える。 */}
          {visited && <span className={styles.badgeVisited}>行った</span>}
        </span>
        {/*
         * 名前の隣に出した分は、住所の行で繰り返さない（同じ文字列が
         * 2 つ並ぶと壊れて見える）。**ただし出していない分は残す**——
         * 市区町村だけで見分けが付く店から町名まで消すと、持っている
         * 情報が画面から減る。判断は src/features/search/utils/same-name.ts にある。
         */}
        {/*
         * data-shop-meta-parts は、どの欄を出したかを区切って持つ。
         * **見た目は変わらない。** 文字列を目で突き合わせると、住所に
         * 市名が入っている店（「横浜市」/「横浜市磯子区上中里町669-1」）や、
         * 欄の中に空白がある店で誤判定するため、テストが欄ごとに
         * 比べられるようにしてある。
         */}
        <span className={styles.meta} data-shop-meta data-shop-meta-parts={meta.join("\u0000")}>
          {meta.join(" ")}
        </span>
        {shop.openingHours && (
          // 地図データの記載だと分かる書き方にそろえる（店のページ・家系マッチと同じ。#255）。
          <span className={styles.meta}>
            営業 {openingHoursLabel(shop.openingHours)}（地図の記載）
          </span>
        )}
      </span>
      {stub === "number" && shop.distanceKm !== undefined && (
        <span className={styles.distance}>{formatDistance(shop.distanceKm)}</span>
      )}
    </button>
  );
});

/**
 * 2 行目（#255）。味が分かっている店だけ、地図のピンと同じ色の丼の印と味の言葉を添える。
 * ブランドは店名に入っていないときだけ（「町田商店」を店名の下で繰り返さない）。どちらも無ければ出さない
 * ——多数派に「味は未判定」が並ぶと、一覧が判定の弱さを見せる場所になった。味が未判定でもブランドは残す
 * （「吉村家」で探して出た高松家が、なぜ出たか分かるように）。
 * バッジにせず控えめな文字にする（黒・茶赤・灰のバッジが並ぶと、意味の違わないものが違う色に見えた）。
 */
function ShopFacts({ shop }: { shop: Shop }) {
  const taste = TASTE_WORDS[shop.taste];
  const brand = shop.brand && !shop.name.includes(shop.brand) ? shop.brand : undefined;
  if (!taste && !brand) return null;
  return (
    <span
      className={styles.shopFacts}
      style={taste ? ({ "--taste-ink": taste.ink } as CSSProperties) : undefined}
      data-taste={shop.taste}
    >
      {taste && (
        <>
          <svg className={styles.tasteMark} viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="10" fill={PIN_COLORS[shop.taste]} />
            <path
              fill="#fff"
              d="M5 8.3h10V10H5zM5.6 10h8.8q-.3 4.4-4.4 4.4T5.6 10zM8.4 14.2h3.2v1.1H8.4z"
            />
          </svg>
          <b className={styles.tasteWord}>{taste.word}</b>
        </>
      )}
      {taste && brand && "・"}
      {brand}
    </span>
  );
}

export function ShopList({
  shops,
  ranked,
  ticket,
  stub = "number",
  selectedId,
  onSelect,
  detail,
  emptyMessage,
  emptyHint,
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
      <StateNote kind="empty" hint={emptyHint}>
        {emptyMessage ?? "条件に合う店舗が見つかりませんでした。"}
      </StateNote>
    );
  }

  return (
    <ul className={ticket ? `${styles.list} ${styles.tickets}` : styles.list}>
      {shops.map((shop, i) => (
        <li
          key={shop.id}
          className={selectedId === shop.id ? styles.listItemSelected : undefined}
          // 3 軒が 1 軒ずつ出る順番。CSS の animation-delay が読む。
          // 最初の 3 枚だけずらして出す（200 枚目が 24 秒後に出ないように）。
          style={ticket && i < 3 ? ({ "--ticket-index": i } as CSSProperties) : undefined}
        >
          <ShopCard
            shop={shop}
            index={i}
            selected={selectedId === shop.id}
            expandable={detail !== undefined}
            visited={visitedIds?.has(shop.id) ?? false}
            label={labels.get(shop.id)}
            ranked={ranked}
            stub={stub}
            onSelect={onSelect}
          />
          {selectedId === shop.id && detail}
        </li>
      ))}
    </ul>
  );
}
