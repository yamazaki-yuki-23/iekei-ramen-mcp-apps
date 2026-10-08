import { useEffect, useRef, useState } from "react";
import { TASTES, type Origin, type TasteKey } from "../lib/types";
import styles from "../mcp-app.module.css";
import type { FormValues } from "./SearchForm";
import { MachineShell } from "./MachineShell";

/** どこで探すか。都道府県は form.prefecture、近くでは基準地点を使う。 */
export type Where = "near" | "pref" | "all";

/* 和文は 1 文を 1 本の文字列にする（JSX の改行は空白 1 個に畳まれる）。 */
const CAVEAT = "家系の判定と味の傾向は推定、距離は直線距離です。";

const TASTE_KEYS: Array<{ value: TasteKey | ""; label: string }> = [
  { value: "", label: "こだわらない" },
  { value: "rich", label: TASTES.rich.label },
  { value: "creamy", label: TASTES.creamy.label },
  { value: "chain", label: TASTES.chain.label },
];

interface Props {
  prefectures: string[];
  form: FormValues;
  onForm: (values: FormValues) => void;
  origin?: Origin;
  /**
   * 発券。選んだ「どこで」と条件で 3 軒を出す。isCurrent は、この発券がまだ最新か
   * （後から別の発券・地図へ移動・画面の切り替えが無いか）。位置取得を待つ間に使う。
   */
  onIssue: (where: Where, values: FormValues, isCurrent: () => boolean) => void;
  /** 地図で範囲を選ぶ画面へ。 */
  onOpenMap: () => void;
  busy: boolean;
  /** 会話の中では小さく出す（見出しの帯と但し書きを省く）。 */
  compact?: boolean;
}

/** いまの条件から、最初に点けておく「どこで」を決める。 */
function initialWhere(form: FormValues, origin?: Origin): Where {
  if (form.prefecture) return "pref";
  return origin ? "near" : "all";
}

/**
 * 券売機（#144）。家系の店で誰もがやる「選んで、券が出てくる」動作を借りる。
 *
 * **キーは条件を選ぶだけで、取りに行かない。** 「発券する」を押して初めて 3 軒が
 * 出る。押す手応えを残すため（選ぶたびに入れ替わると、決める場面が消える）。
 * 押されているキーはランプの丸の塗りでも示す（色だけに頼らない）。
 */
export function TicketMachine({
  prefectures,
  form,
  onForm,
  origin,
  onIssue,
  onOpenMap,
  busy,
  compact,
}: Props) {
  const [where, setWhere] = useState<Where>(() => initialWhere(form, origin));
  /*
   * 発券の操作番号。位置取得は MCP の呼び出しより前に始まるので、通信の通し番号では
   * 古い発券を捨てられない（NearbyPanel と同じ。docs/development.md）。別の発券・
   * 地図へ移動・画面の切り替え（アンマウント）で番号を進め、遅れて届いた位置を捨てる。
   */
  const operation = useRef(0);
  useEffect(
    () => () => {
      operation.current += 1;
    },
    [],
  );

  /*
   * キーを押したら、発券の途中でも条件の下書きが変わったと親に伝える（onForm）。
   * 親は古い発券の応答を捨て、位置取得の途中なら操作番号で捨てる（#144）。
   */
  const choose = (next: Where, prefecture = next === "pref" ? form.prefecture : "") => {
    operation.current += 1;
    setWhere(next);
    onForm({ ...form, prefecture });
  };

  return (
    <MachineShell title="家系 券売機" hint="押して、発券" caveat={CAVEAT} compact={compact}>
      <div role="group" aria-labelledby="machine-where">
        <h3 className={styles.machineGroup} id="machine-where">
          ① どこで
        </h3>
        <div className={styles.keys}>
          <button
            type="button"
            className={styles.key}
            aria-pressed={where === "near"}
            onClick={() => choose("near")}
          >
            近くで<small>現在地から</small>
          </button>
          {/*
           * 都道府県はキーの中に選択欄を持つ。選んだ時点でこのキーが点く。
           * 選択欄そのものが操作の口なので、キーは押せる見た目の入れ物にする。
           */}
          <label className={where === "pref" ? styles.keySelectOn : styles.keySelect}>
            <span>都道府県</span>
            <select
              id="pref"
              className={styles.keySelectInput}
              value={form.prefecture}
              aria-label="都道府県"
              onChange={(e) => choose(e.target.value ? "pref" : "all", e.target.value)}
            >
              <option value="">選ぶ</option>
              {prefectures.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.key}
            aria-pressed={where === "all"}
            onClick={() => choose("all")}
          >
            全国<small>どこでも</small>
          </button>
          <button
            type="button"
            className={styles.keyLink}
            onClick={() => {
              operation.current += 1;
              onOpenMap();
            }}
          >
            地図で選ぶ<small>範囲を自分で</small>
          </button>
        </div>
      </div>
      <div role="group" aria-labelledby="machine-taste">
        <h3 className={styles.machineGroup} id="machine-taste">
          ② 味の傾向（参考）
        </h3>
        <div className={styles.keys}>
          {TASTE_KEYS.map(({ value, label }) => (
            <button
              key={label}
              type="button"
              className={styles.key}
              aria-pressed={form.taste === value}
              onClick={() => {
                operation.current += 1;
                onForm({ ...form, taste: value });
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        className={styles.issue}
        onClick={() => {
          const started = ++operation.current;
          onIssue(where, form, () => operation.current === started);
        }}
        /*
         * 取得中も押せる。押し直した発券が最後に効く（追い越した古い応答は
         * use-server-tools の通し番号が捨てる）。止めると「壊れた」と読まれる。
         */
        aria-busy={busy}
      >
        発券する<small>3 軒が出てきます</small>
      </button>
    </MachineShell>
  );
}
