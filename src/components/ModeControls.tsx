import type { ComponentProps } from "react";
import type { Origin, OriginSource, SearchMode } from "../lib/types";
import { NearbyPanel } from "./NearbyPanel";
import { SearchForm, type FormValues } from "./SearchForm";
import { TicketMachine } from "./TicketMachine";
import { MachineShell } from "./MachineShell";
import { BrandKeys } from "./BrandKeys";
import type { BrandCount } from "../lib/brands";

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
  onSearchPlace: (query: string) => Promise<{ lat: number; lon: number; label: string } | null>;
  notice: string | null;
  busy: boolean;
  /** 「迷ったら」の発券。券売機で選んだ「どこで」と条件を受け取る。 */
  onIssue: ComponentProps<typeof TicketMachine>["onIssue"];
  /** 券売機の「地図で選ぶ」。 */
  onOpenMap: () => void;
  /** 券売機の「近くで」を点けたままにする（現在地が分からなかった直後。#147）。 */
  wantsNear?: boolean;
  /** 会話の中では券売機を小さく出す。 */
  compact: boolean;
  /** 店名の券売機に並べるブランド。 */
  brands: BrandCount[];
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
  onSearchPlace,
  notice,
  busy,
  onIssue,
  onOpenMap,
  wantsNear,
  compact,
  brands,
}: Props) {
  /*
   * 「行った店」に条件の入力欄は無い。**出すと壊れる**——ここで都道府県や味を
   * 変えると runConditions が「検索フォーム」として扱い、`search-iekei-ramen`
   * を呼んで記録の画面から弾き出す（Codex の指摘で気付いた）。
   * 記録はその人のもので、条件で絞る対象ではない。
   */
  if (mode === "visited") return null;

  if (mode === "nearby") {
    return (
      <MachineShell
        title="近くの券売機"
        hint="押して、発券"
        caveat="距離は直線距離です。歩く道のりではありません。"
        compact={compact}
      >
        <NearbyPanel
          origin={origin}
          onLocate={onLocate}
          onLocateByHost={onLocateByHost}
          onSearchPlace={onSearchPlace}
          notice={notice}
          busy={busy}
        />
      </MachineShell>
    );
  }

  // 「迷ったら」は券売機。キーは選ぶだけで、「発券する」で 3 軒を出す（#144）。
  if (mode === "decide") {
    return (
      <TicketMachine
        prefectures={prefectures}
        form={form}
        onForm={onForm}
        origin={origin}
        onIssue={onIssue}
        onOpenMap={onOpenMap}
        wantsNear={wantsNear}
        busy={busy}
        compact={compact}
      />
    );
  }

  // 店名の券売機（#144）。ブランドのキーを押すか打って、発券する。
  if (mode === "form") {
    return (
      <MachineShell
        title="店名の券売機"
        hint="押すか、打って発券"
        caveat="家系の判定は推定です。ブランドは地図の記載から判定しています。"
        compact={compact}
      >
        <BrandKeys
          brands={brands}
          keyword={form.keyword}
          onPick={(name) => onForm({ ...form, keyword: name })}
        />
        <SearchForm
          prefectures={prefectures}
          values={form}
          onChange={onForm}
          onSubmit={() => onSubmit(form)}
          busy={busy}
        />
      </MachineShell>
    );
  }

  // 地図は選択だけで完結させる（選んだ瞬間に呼び直す）。キーワード欄は出さない。
  return (
    <SearchForm
      prefectures={prefectures}
      values={{ ...form, keyword: "" }}
      onChange={(next) => {
        onForm(next);
        onSubmit(next);
      }}
      onSubmit={() => onSubmit(form)}
      busy={busy}
      hideKeyword
    />
  );
}
