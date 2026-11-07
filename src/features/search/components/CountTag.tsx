import styles from "../styles/search.module.css";

/**
 * 件数（または並べた根拠）の札。タブの下、結果の上に置く。
 * reserve があれば、件数がまだ無い間も同じ大きさの札で場所を取る（見せない・読ませない）。
 * 結果が届いた瞬間に札が差し込まれて、下が約 20px ずれるのを防ぐ（#214）。
 */
export function CountTag({ count, reserve }: { count: string | null; reserve?: string }) {
  if (count)
    return (
      <p className={styles.countLine}>
        <span className={styles.count} data-announce>
          {count}
        </span>
      </p>
    );
  if (!reserve) return null;
  return (
    <p className={styles.countLine} aria-hidden="true">
      <span className={`${styles.count} pending-reserve`}>{reserve}</span>
    </p>
  );
}
