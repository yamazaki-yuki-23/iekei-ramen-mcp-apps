import styles from "./camera.module.css";

/** 選ぶもの（1 つだけ選べるチップ）。もう一度押すと外せるものは allowNone。 */
export function Chips<T extends string>({
  label,
  items,
  value,
  onChange,
  allowNone,
}: {
  label: string;
  items: { key: T; label: string }[];
  value: T | null;
  onChange(v: T | null): void;
  allowNone?: boolean;
}) {
  return (
    <fieldset className={styles.chips}>
      <legend>{label}</legend>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          aria-pressed={value === it.key}
          className={styles.chip}
          onClick={() => onChange(allowNone && value === it.key ? null : it.key)}
        >
          {it.label}
        </button>
      ))}
    </fieldset>
  );
}
