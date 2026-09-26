import { useCallback } from "react";
import type { FormValues } from "../components/SearchForm";
import type { Bounds, Origin, OriginSource, SearchMode, Shop } from "../lib/types";

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
  /** いま効いている範囲。地図モードで「この範囲で探す」を使ったときだけ入る。 */
  bounds?: Bounds;
  /** いま効いている都道府県。範囲を捨てるかは「変わったか」で決める。 */
  prefecture?: string;
  runArea: (bounds: Bounds, values: FormValues, origin?: Origin) => void;
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
  bounds,
  prefecture,
  runArea,
  runDecide,
  runNearby,
}: Options) {
  /** 条件が決まったときに呼ぶもの。モードで行き先が変わる。 */
  const runConditions = useCallback(
    (values: FormValues) => {
      if (mode === "decide") {
        runDecide(values, origin, 0, activeKeyword);
        return;
      }
      if (mode !== "map") {
        runSearch(values, "form");
        return;
      }
      /*
       * 地図では、いま効いている範囲を保つ。
       *
       * **味は「どこ」ではなく「何」。** 味を変えただけで範囲が落ちると、
       * 地図に出ていた土地の結果が黙って全国に戻る（実際にそうなっていた）。
       *
       * **「都道府県が入っているか」ではなく「変わったか」で決める。**
       * 入っているかで決めると、都道府県と範囲の両方が効いている状態
       * （モデルは両方付きで tool を呼べる）で味を変えただけで県全体に広がる
       * （実測: 枠の中 4 件が県全体の 6 件になった）。
       */
      const changedPrefecture = (values.prefecture || undefined) !== prefecture;
      if (bounds && !changedPrefecture) runArea(bounds, values, origin);
      else runSearch(values, "map", origin);
    },
    [activeKeyword, bounds, mode, origin, prefecture, runArea, runDecide, runSearch],
  );

  const switchMode = useCallback(
    (next: SearchMode) => {
      setMode(next);
      onSelect(null);
      /*
       * 地図には基準地点も持ち込む。印と同心円だけに使い、絞り込みはしない。
       *
       * **いま居るタブをもう一度押すのは入り直しではない。** そこで範囲を
       * 落とすと、押しただけで母数が全国に広がり、理由が画面に残らない
       * （「迷ったら」でキーワードを保つのと同じ扱い）。他のタブから入り直す
       * ときは、その画面の範囲ではないので持ち込まない。
       */
      if (next === "map") {
        if (mode === "map" && bounds) runArea(bounds, form, origin);
        else runSearch(form, "map", origin);
      } else if (next === "form") runSearch(form, "form");
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
    [
      activeKeyword,
      bounds,
      form,
      mode,
      onSelect,
      origin,
      runArea,
      runDecide,
      runNearby,
      runSearch,
      setMode,
    ],
  );

  return { runConditions, switchMode };
}
