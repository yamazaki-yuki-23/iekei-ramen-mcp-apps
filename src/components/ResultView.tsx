import { useRef, type ReactNode } from "react";
import type { Bounds, SearchMode, Shop } from "../lib/types";
import styles from "../mcp-app.module.css";
import { MapView } from "./MapView";
import { MapToolbar, type FullscreenControl } from "./MapToolbar";
import { ShopList } from "./ShopList";

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
  busy?: boolean;
}

/**
 * 地図モードの一覧。全件並べると長すぎるので先頭 20 件で切る。
 * ただしマーカーから選んだ店が 20 件目より後ろだと詳細の置き場所が無くなるので、
 * その店だけは先頭に持ってくる。
 */
function mapListShops(shops: Shop[], selectedId?: string): Shop[] {
  const head = shops.slice(0, 20);
  if (!selectedId || head.some((s) => s.id === selectedId)) return head;
  const selected = shops.find((s) => s.id === selectedId);
  return selected ? [selected, ...head.slice(0, 19)] : head;
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
  busy = false,
}: Props) {
  /*
   * いま地図に出ている範囲の読み取り口。**値ではなく読み方を持つ。**
   * 値で持つと、寄せ終わる前に押されたときに古い範囲で探してしまう。
   */
  const getBoundsRef = useRef<(() => Bounds) | null>(null);
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
          onReady={(getBounds) => (getBoundsRef.current = getBounds)}
          initialBounds={bounds}
          refit={!bounds}
        />
        <ShopList
          shops={mapListShops(shops, selectedId)}
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
