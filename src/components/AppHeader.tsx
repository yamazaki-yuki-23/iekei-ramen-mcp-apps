import styles from "../mcp-app.module.css";
import { BrandMark } from "./BrandMark";
import { APP_HEAD_ID } from "./PromiseHero";

/** 見出しの行。ロゴ・ページの見出し・件数（または並べた根拠）の札。 */
export function AppHeader({ h1, count }: { h1: string; count: string | null }) {
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
      ) : null}
    </div>
  );
}
