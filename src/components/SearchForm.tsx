import { TASTES, type TasteKey } from "../lib/types";
import styles from "../mcp-app.module.css";

export interface FormValues {
  prefecture: string;
  taste: TasteKey | "";
  keyword: string;
}

interface Props {
  prefectures: string[];
  values: FormValues;
  onChange: (values: FormValues) => void;
  onSubmit: () => void;
  busy: boolean;
  /** 地図モードではキーワード欄を出さない（絞り込みは選択だけで完結する）。 */
  hideKeyword?: boolean;
}

const TASTE_KEYS: TasteKey[] = ["rich", "creamy", "chain"];

export function SearchForm({ prefectures, values, onChange, onSubmit, busy, hideKeyword }: Props) {
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className={styles.row}>
        <label className={styles.label} htmlFor="pref">都道府県</label>
        <select
          id="pref"
          className={styles.select}
          value={values.prefecture}
          onChange={(e) => onChange({ ...values, prefecture: e.target.value })}
        >
          <option value="">すべて</option>
          {prefectures.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>味の傾向</span>
        <div className={styles.chips}>
          <button
            type="button"
            className={`${styles.chip} ${values.taste === "" ? styles.chipActive : ""}`}
            onClick={() => onChange({ ...values, taste: "" })}
          >
            こだわらない
          </button>
          {TASTE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              title={TASTES[key].description}
              className={`${styles.chip} ${values.taste === key ? styles.chipActive : ""}`}
              onClick={() => onChange({ ...values, taste: values.taste === key ? "" : key })}
            >
              {TASTES[key].label}
            </button>
          ))}
        </div>
      </div>

      {!hideKeyword && (
        <div className={styles.row}>
          <label className={styles.label} htmlFor="kw">キーワード</label>
          <input
            id="kw"
            className={styles.input}
            type="search"
            placeholder="店名・ブランド・地名"
            value={values.keyword}
            onChange={(e) => onChange({ ...values, keyword: e.target.value })}
          />
          <button type="submit" className={styles.button} disabled={busy}>
            {busy ? "検索中…" : "検索"}
          </button>
        </div>
      )}
    </form>
  );
}
