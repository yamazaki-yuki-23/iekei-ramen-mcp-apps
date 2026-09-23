import { formatDistance } from "../lib/geo";
import { describeLeg, googleMapsRouteUrl, MAX_STOPS, type Route } from "../lib/route";
import type { Origin, Shop } from "../lib/types";
import styles from "../mcp-app.module.css";

/* 和文は 1 文を 1 本の文字列にする（JSX の改行は空白 1 個に畳まれる）。 */
const NOTE =
  "距離はすべて直線距離です。実際の道のりはこれより長くなります。経路と所要時間は地図アプリ側でご確認ください。";
const SINGLE_HINT = "もう 1 軒足すと、回る順番と距離が出ます。";

interface Props {
  /** 回る順に並べ替え済みの順路。地図と同じものを親が 1 度だけ組む。 */
  route: Route;
  /** 出発点。あれば 1 軒目までの距離も出せる。 */
  origin?: Origin;
  /** その店を外す。 */
  onRemove: (shop: Shop) => void;
  /** すべて外す。 */
  onClear: () => void;
  /** 外部リンクを開く（ホスト経由）。 */
  onOpenLink: (url: string) => void;
}

/**
 * 「まわる店」。
 *
 * 決めたあと、ユーザーは必ずアプリを出て地図アプリを開く。そこが手作業の
 * ままだと体験が途切れるので、回る順番・距離・地図アプリへの受け渡しまでを
 * ここにまとめる。
 *
 * **順番はこちらで決める。** 足した順のまま出すと、戻る形の順路になっても
 * 気付けない。並べ替えた事実と、何を基準にしたか（直線距離）は画面に書く。
 */
export function RoutePanel({ route, origin, onRemove, onClear, onOpenLink }: Props) {
  // 空のときは何も出さない。空の枠は「まだ置かれていない場所」に見えて、
  // 操作できる何かだと誤解される。
  if (route.legs.length === 0) return null;

  const single = route.legs.length === 1;

  return (
    <section className={styles.route} aria-label="まわる店">
      <div className={styles.routeHead}>
        <h2 className={styles.routeTitle}>
          まわる店（{route.legs.length} / {MAX_STOPS} 軒）
        </h2>
        <button type="button" className={styles.buttonSecondary} onClick={onClear}>
          すべて外す
        </button>
      </div>

      <ol className={styles.routeList}>
        {route.legs.map((leg, i) => (
          <li key={leg.shop.id} className={styles.routeItem}>
            <span className={styles.routeOrder}>{i + 1}</span>
            <span className={styles.routeBody}>
              <span className={styles.shopName}>{leg.shop.name}</span>
              <span className={styles.meta}>{describeLeg(leg, i, origin)}</span>
            </span>
            <button
              type="button"
              className={styles.chip}
              onClick={() => onRemove(leg.shop)}
              aria-label={`${leg.shop.name}をまわる店から外す`}
            >
              外す
            </button>
          </li>
        ))}
      </ol>

      <p className={styles.routeTotal}>
        {single
          ? SINGLE_HINT
          : `合計 ${formatDistance(route.totalKm)}${route.fromOrigin ? "（出発点からの直線距離）" : "（直線距離）"}`}
      </p>

      <div className={styles.routeActions}>
        <button
          type="button"
          className={styles.button}
          onClick={() => onOpenLink(googleMapsRouteUrl(route, origin))}
        >
          Google マップで開く
        </button>
      </div>

      <p className={styles.selectedNote}>{NOTE}</p>
    </section>
  );
}
