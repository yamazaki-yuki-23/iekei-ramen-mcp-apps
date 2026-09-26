import { useCallback } from "react";
import type { FormValues } from "../components/SearchForm";
import type { Origin, OriginSource, SearchMode, Shop } from "../lib/types";

interface Options {
  mode: SearchMode;
  setMode: (mode: SearchMode) => void;
  form: FormValues;
  /** 現在の payload の基準地点。モードをまたいで引き継ぐ。 */
  origin?: Origin;
  /** いま効いているキーワード（「迷ったら」のみ）。 */
  activeKeyword?: string;
  onSelect: (shop: Shop | null) => void;
  runSearch: (values: FormValues, mode: "form" | "map", origin?: Origin) => void;
  runDecide: (
    values: FormValues,
    origin: Origin | undefined,
    round: number,
    keyword?: string,
  ) => void;
  runNearby: (lat: number, lon: number, label: string | undefined, source: OriginSource) => void;
}

/**
 * モードを切り替えたとき・条件を変えたときに、どの tool を呼ぶか。
 *
 * 画面の組み立て側に置くと分岐が集まりすぎる（react-doctor の複雑度でも落ちた）。
 * 「どの操作がどの tool になるか」という 1 つの関心なので、ここにまとめる。
 */
export function useModeSwitch({
  mode,
  setMode,
  form,
  origin,
  activeKeyword,
  onSelect,
  runSearch,
  runDecide,
  runNearby,
}: Options) {
  /** 条件が決まったときに呼ぶもの。モードで行き先が変わる。 */
  const runConditions = useCallback(
    (values: FormValues) => {
      if (mode === "decide") runDecide(values, origin, 0, activeKeyword);
      else if (mode === "map") runSearch(values, "map", origin);
      else runSearch(values, "form");
    },
    [activeKeyword, mode, origin, runDecide, runSearch],
  );

  const switchMode = useCallback(
    (next: SearchMode) => {
      setMode(next);
      onSelect(null);
      // 地図には基準地点も持ち込む。印と同心円だけに使い、絞り込みはしない。
      if (next === "map") runSearch(form, "map", origin);
      else if (next === "form") runSearch(form, "form");
      /*
       * 「迷ったら」は直前のモードで決まった基準地点を引き継ぐ。現在地から探した
       * 直後に切り替えたなら、そのまま近い順で絞れる。
       *
       * 他のタブから入り直すときはキーワードを持ち込まない（検索フォームに
       * 残っていた語が、欄の無い画面で見えないまま効く）。ただし、いま居るタブを
       * もう一度押すのは入り直しではない。そこで落とすと、押しただけで母数が
       * 全国に広がり、チップも消えて理由が残らない。
       */
      if (next === "decide")
        runDecide(form, origin, 0, mode === "decide" ? activeKeyword : undefined);
      /*
       * 現在地モードも、基準地点が分かっているなら取り直す。
       * 呼ばずに戻ると、直前のモードの payload（「迷ったら」の 3 軒など）が
       * そのまま「近い順」として並んでしまう。基準地点が無いときは呼ばない
       * ——その場合は awaitingOrigin が立ち、地点の指定を促す画面になる。
       */
      if (next === "nearby" && origin) {
        runNearby(origin.lat, origin.lon, origin.label, origin.source);
      }
    },
    [activeKeyword, form, mode, onSelect, origin, runDecide, runNearby, runSearch, setMode],
  );

  return { runConditions, switchMode };
}
