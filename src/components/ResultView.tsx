import type { ReactNode } from "react";
import type { SearchMode, Shop } from "../lib/types";
import styles from "../mcp-app.module.css";
import { MapView } from "./MapView";
import { ShopList } from "./ShopList";

const EMPTY_MESSAGE: Record<SearchMode, string> = {
  form: "条件に合う店舗が見つかりませんでした。",
  nearby: "現在地を指定すると近い順に 5 件表示します。",
  map: "この条件では地図に表示できる店舗がありません。",
};

interface Props {
  mode: SearchMode;
  shops: Shop[];
  selectedId?: string;
  onSelect: (shop: Shop) => void;
  /** 選択中のカードの直下に出すもの。 */
  detail?: ReactNode;
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
export function ResultView({ mode, shops, selectedId, onSelect, detail }: Props) {
  if (mode === "map") {
    return (
      <div className={styles.mapLayout}>
        <MapView shops={shops} selectedId={selectedId} onSelect={onSelect} />
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
