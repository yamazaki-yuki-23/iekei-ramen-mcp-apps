import { useRef, useState, type ReactNode } from "react";
import { focusLabel, mapListShops } from "../lib/map-list";
import type { Bounds, Origin, SearchMode, Shop } from "../lib/types";
import styles from "../mcp-app.module.css";
import { MapView } from "./MapView";
import { MapToolbar, type FullscreenControl } from "./MapToolbar";
import { ShopList } from "./ShopList";

/*
 * 円の意味は画面に書く。**直線距離だと明示する**（徒歩◯分に換算する材料は
 * 持っていないので、黙っていると「歩いて 6 分」と読まれる）。
 */
const RING_NOTE = "点線の円は基準地点からの直線距離 500m と 1km です。";

const EMPTY_MESSAGE: Record<SearchMode, string> = {
  form: "条件に合う店舗が見つかりませんでした。",
  nearby: "現在地を指定すると近い順に 5 件表示します。",
  map: "この条件では地図に表示できる店舗がありません。",
  // 「迷ったら」は専用の画面が自前で出すので、ここは使わない。
  decide: "条件に合う店舗が見つかりませんでした。",
};

interface Props {
  mode: SearchMode;
  shops: Shop[];
  selectedId?: string;
  onSelect: (shop: Shop) => void;
  /** 選択中のカードの直下に出すもの。 */
  detail?: ReactNode;
  /** 「まわる店」の順路。地図にだけ線を引く。 */
  route?: Shop[];
  routeOrigin?: { lat: number; lon: number };
  /** 地図の全画面化。ホストが対応していなければ渡ってこない。 */
  fullscreen?: FullscreenControl;
  /** 地図に出ている範囲で探し直す。 */
  onSearchArea?: (bounds: Bounds) => void;
  /** 範囲で絞った結果なら、その範囲。地図の初期表示に使い、寄せ直しもしない。 */
  bounds?: Bounds;
  /** 基準地点。地図に印と同心円を出す。 */
  origin?: Origin;
  busy?: boolean;
}

/**
 * 検索結果の表示。地図モードだけ地図と一覧を並べる。
 */
export function ResultView({
  mode,
  shops,
  selectedId,
  onSelect,
  detail,
  route,
  routeOrigin,
  fullscreen,
  onSearchArea,
  bounds,
  origin,
  busy = false,
}: Props) {
  /*
   * いま地図に出ている範囲の読み取り口。**値ではなく読み方を持つ。**
   * 値で持つと、寄せ終わる前に押されたときに古い範囲で探してしまう。
   */
  const getBoundsRef = useRef<(() => Bounds) | null>(null);
  /*
   * 押した塊の中身。
   *
   * **寄れば解ける、とは限らない。** 5.2m しか離れていない 2 軒は、地図の
   * 最大ズームでもまとまったままで、寄せるだけだと永久に選べない
   * （実測: ろくの家 / 稲和家ラーメンは zoom 19 でも 21.1px）。
   * 押した塊の中身を一覧に出せば、どの塊にも必ず行き先がある。
   */
  const [focused, setFocused] = useState<Shop[] | null>(null);
  if (mode === "map") {
    return (
      <div className={styles.mapLayout}>
        <MapToolbar
          fullscreen={fullscreen}
          busy={busy}
          onSearchArea={
            onSearchArea &&
            (() => {
              const shown = getBoundsRef.current?.();
              if (shown) onSearchArea(shown);
            })
          }
        />
        <MapView
          shops={shops}
          selectedId={selectedId}
          onSelect={onSelect}
          route={route}
          routeOrigin={routeOrigin}
          expanded={fullscreen?.expanded ?? false}
          onClusterSelect={setFocused}
          onReady={(getBounds) => (getBoundsRef.current = getBounds)}
          initialBounds={bounds}
          refit={!bounds}
          origin={origin}
        />
        {origin && <p className={styles.mapNote}>{RING_NOTE}</p>}
        {focused && (
          <div className={styles.focusHead}>
            <span className={styles.meta}>{focusLabel(focused.length)}</span>
            <button
              type="button"
              className={styles.buttonSecondary}
              onClick={() => setFocused(null)}
            >
              すべて表示
            </button>
          </div>
        )}
        <ShopList
          shops={mapListShops(focused ?? shops, selectedId, shops)}
          selectedId={selectedId}
          onSelect={onSelect}
          detail={detail}
          emptyMessage={EMPTY_MESSAGE.map}
        />
      </div>
    );
  }

  return (
    <ShopList
      shops={shops}
      ranked={mode === "nearby"}
      selectedId={selectedId}
      onSelect={onSelect}
      detail={detail}
      emptyMessage={EMPTY_MESSAGE[mode]}
    />
  );
}
