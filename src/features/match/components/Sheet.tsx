import styles from "../styles/match.module.css";

/*
 * 山の上に重ねる紙。見終わったとき・「今日はここ」・行きたいリスト・読み込み中・失敗。
 * 見出しに焦点を移して、何が出たかを読み上げる。
 */
const focusHeading = (el: HTMLHeadingElement | null) => el?.focus();

export function Sheet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.sheet} aria-labelledby="sheet-title">
      <h2 id="sheet-title" tabIndex={-1} ref={focusHeading}>
        {title}
      </h2>
      {children}
    </section>
  );
}
