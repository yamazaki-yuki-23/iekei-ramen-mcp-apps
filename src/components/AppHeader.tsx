import styles from "../mcp-app.module.css";
import { BrandMark } from "./BrandMark";
import { APP_HEAD_ID } from "./PromiseHero";

/**
 * 見出しの行。ロゴ・ページの見出し・件数（または並べた根拠）の札。
 * reserve があれば、件数がまだ無い間も同じ大きさの札で場所を取る（見せない・読ませない）。
 * 結果が届いた瞬間に札が差し込まれて、下が約 20px ずれるのを防ぐ（#214）。
 */
export function AppHeader({
  h1,
  count,
  reserve,
}: {
  h1: string;
  count: string | null;
  reserve?: string;
}) {
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
      {count ? (
        <span className={styles.count} data-announce>
          {count}
        </span>
      ) : reserve ? (
        <span className={`${styles.count} pending-reserve`} aria-hidden="true">
          {reserve}
        </span>
      ) : null}
    </div>
  );
}
