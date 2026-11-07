import styles from "../styles/search.module.css";
import { BrandMark } from "../../../components/BrandMark";
import { APP_HEAD_ID } from "./PromiseHero";

/**
 * 見出しの行。ロゴとページの見出しだけ。
 *
 * **件数の札はここに置かない（#368）。** 見出しと札が同じ行に入らないと札が 2 行目へ落ち、
 * タブを切り替えるたびにタブが約 45px 上下した（押そうとしたタブが指の下から逃げる）。
 * 札はタブの下（CountTag）、見出しは 1 行に収める。
 */
export function AppHeader({ h1 }: { h1: string }) {
  return (
    <div className={styles.header} id={APP_HEAD_ID}>
      <div className={styles.headerMain}>
        {/* ロゴは飾りなので、見出しの読み上げには載せない。 */}
        <span className={styles.brandMark}>
          <BrandMark size={36} />
        </span>
        <h1 className={styles.title} data-announce>
          {h1}
        </h1>
      </div>
    </div>
  );
}
