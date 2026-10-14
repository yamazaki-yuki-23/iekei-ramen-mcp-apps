import styles from "../styles/match.module.css";
import { Sheet } from "./Sheet";

export function StatusSheet({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <Sheet title={title}>
      <p>{text}</p>
      {action && <div className={styles.row}>{action}</div>}
    </Sheet>
  );
}
