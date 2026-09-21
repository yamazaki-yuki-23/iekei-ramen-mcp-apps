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
}

/**
 * 検索結果の表示。地図モードだけ地図と一覧を並べる。
 *
 * 地図モードの一覧を先頭 20 件で切っているのは、マーカーと違って
 * カードは全件並べると長くなりすぎるため。選んだ店は上のパネルに出る。
 */
export function ResultView({ mode, shops, selectedId, onSelect }: Props) {
  if (mode === "map") {
    return (
      <div className={styles.mapLayout}>
        <MapView shops={shops} selectedId={selectedId} onSelect={onSelect} />
        <ShopList
          shops={shops.slice(0, 20)}
          selectedId={selectedId}
          onSelect={onSelect}
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
      emptyMessage={EMPTY_MESSAGE[mode]}
    />
  );
}
