import type { Origin, OriginSource, SearchMode } from "../lib/types";
import { NearbyPanel } from "./NearbyPanel";
import { SearchForm, type FormValues } from "./SearchForm";

interface Props {
  mode: SearchMode;
  prefectures: string[];
  form: FormValues;
  onForm: (values: FormValues) => void;
  /** 条件で検索し直す。どの tool を叩くかはモードで決まる。 */
  onSubmit: (values: FormValues) => void;
  origin?: Origin;
  onLocate: (lat: number, lon: number, label: string | undefined, source: OriginSource) => void;
  onLocateByHost: () => Promise<boolean>;
  onGeocode: (query: string) => Promise<{ lat: number; lon: number; label: string } | null>;
  notice: string | null;
  busy: boolean;
}

/**
 * モードごとの条件入力欄。
 *
 * 画面の組み立て側に 4 つの分岐を並べると、1 つの関数に条件が集まりすぎて
 * 読めなくなる（react-doctor の複雑度でも落ちた）。ここに隔離しておく。
 *
 * 地図と「迷ったら」は同じ入力（都道府県・味）で、キーワードだけ出さない。
 * 絞り込んだ瞬間に呼び直すので、地図はマーカーが、「迷ったら」は 3 軒が入れ替わる。
 */
export function ModeControls({
  mode,
  prefectures,
  form,
  onForm,
  onSubmit,
  origin,
  onLocate,
  onLocateByHost,
  onGeocode,
  notice,
  busy,
}: Props) {
  if (mode === "nearby") {
    return (
      <NearbyPanel
        origin={origin}
        onLocate={onLocate}
        onLocateByHost={onLocateByHost}
        onGeocode={onGeocode}
        notice={notice}
        busy={busy}
      />
    );
  }

  // 検索フォームだけキーワードで絞れる。地図と「迷ったら」は選択だけで完結させる。
  const hideKeyword = mode !== "form";

  return (
    <SearchForm
      prefectures={prefectures}
      values={hideKeyword ? { ...form, keyword: "" } : form}
      onChange={(next) => {
        onForm(next);
        // 検索フォームは「検索」を押すまで待つ。他は選んだ瞬間に反映する。
        if (hideKeyword) onSubmit(next);
      }}
      onSubmit={() => onSubmit(form)}
      busy={busy}
      hideKeyword={hideKeyword}
    />
  );
}
