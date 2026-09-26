import { useCallback, useState } from "react";
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
  /**
   * いま効いている範囲。地図モードで「この範囲で探す」を使ったときだけ入る。
   * ここでは**初期値**としてだけ使い、以降はこのフックが持つ（下を参照）。
   */
  bounds?: Bounds;
  /** いま効いている都道府県。これも初期値だけ。 */
  prefecture?: string;
  /** 入力欄の値を書き換える。「この範囲で探す」で県を外すのに使う。 */
  onForm: (values: FormValues) => void;
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
  onForm,
  runArea,
  runDecide,
  runNearby,
}: Options) {
  /*
   * いま効いている「どこ」——範囲と都道府県を、このフックが持つ。
   *
   * **payload だけを見てはいけない。** 呼び出しの応答が返るまで payload は前の
   * ままで、その間に味を変えられる。payload 頼りだと 2 本目が違う「どこ」で走り、
   * **あとから返った方が勝つ**ので、先に頼んだ条件が捨てられる。
   *
   *   - 範囲: 応答を 1.5 秒遅らせて味を押すと、見出しが「全国」に戻った
   *   - 都道府県: 同じ手順で、外したはずの県が付き直した
   *
   * 押した時点で覚え、落とすときも同じ場所で落とす。payload ごとに key で
   * 作り直されるので、初期値を props から写す形でよい。
   * react-doctor-disable-next-line react-doctor/no-derived-useState
   */
  const [area, setArea] = useState<{ bounds?: Bounds; prefecture?: string }>({
    bounds,
    prefecture,
  });

  /**
   * 地図に出ている範囲で探し直す。
   *
   * **枠が「どこ」を言い直すので都道府県は外す。** 入力欄も同時に空にする。
   * 画面のプルダウンが県を指したままだと、応答が返る前に味を変えたときに
   * その県が付き直し、県境をまたいだ枠が黙って県内へ絞り直される。
   */
  const searchArea = useCallback(
    (next: Bounds) => {
      const cleared = { ...form, prefecture: "" };
      onForm(cleared);
      setArea({ bounds: next, prefecture: undefined });
      runArea(next, cleared, origin);
    },
    [form, onForm, origin, runArea],
  );

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
      const nextPrefecture = values.prefecture || undefined;
      if (area.bounds && nextPrefecture === area.prefecture) {
        runArea(area.bounds, values, origin);
        return;
      }
      // 範囲を捨てる側でも、覚えている「どこ」を同じ場所で更新する。
      setArea({ bounds: undefined, prefecture: nextPrefecture });
      runSearch(values, "map", origin);
    },
    [activeKeyword, area, mode, origin, runArea, runDecide, runSearch],
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
        if (mode === "map" && area.bounds) runArea(area.bounds, form, origin);
        else {
          setArea({ bounds: undefined, prefecture: form.prefecture || undefined });
          runSearch(form, "map", origin);
        }
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
      area,
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

  return { runConditions, searchArea, switchMode };
}
