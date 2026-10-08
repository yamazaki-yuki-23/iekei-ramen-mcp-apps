import type { BrandCount } from "../lib/brands";
import styles from "../mcp-app.module.css";

interface Props {
  brands: BrandCount[];
  /** いまのキーワード。同じ名前のキーが点く。 */
  keyword: string;
  /** キーを押したら、その名前をキーワードに入れる（発券は押した人が決める）。 */
  onPick: (name: string) => void;
}

/**
 * 店名の券売機のブランドのキー（#144）。白紙の入力欄で手が止まらないように、
 * 判定した結果の軒数が多いブランドを並べる。押すとキーワードに入るだけで、
 * 取りに行かない（「発券する」で出す）。もう一度押すと外れる。
 */
export function BrandKeys({ brands, keyword, onPick }: Props) {
  if (brands.length === 0) return null;
  return (
    <div role="group" aria-labelledby="brand-keys">
      <h3 className={styles.machineGroup} id="brand-keys">
        ブランドから（判定した結果の軒数）
      </h3>
      <div className={styles.keys}>
        {brands.map(({ name, count }) => (
          <button
            key={name}
            type="button"
            className={styles.key}
            aria-pressed={keyword === name}
            onClick={() => onPick(keyword === name ? "" : name)}
          >
            {name}
            <small>{count} 軒</small>
          </button>
        ))}
      </div>
    </div>
  );
}
