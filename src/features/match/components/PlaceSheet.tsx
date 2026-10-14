import { useState } from "react";
import styles from "../styles/match.module.css";
import { Sheet } from "./Sheet";

/**
 * 接続元の推定もブラウザの位置も取れなかったとき。ここで地名・駅名を入れて、その近くから探す。
 * 見つからない・地名検索の失敗は、言い分けて同じ場所に出す（入力は消さない）。
 */
export function PlaceSheet({ onSearch }: { onSearch(query: string): Promise<boolean> }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setNote("");
    try {
      if (!(await onSearch(q)))
        setNote(`「${q}」は見つかりませんでした。駅名や市区町村名で試してください。`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "地名の検索に失敗しました。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="現在地が分かりませんでした">
      <p>地名や駅名を入れると、その近くから探せます。</p>
      <form className={styles.row} onSubmit={submit}>
        <label className={styles.placeLabel} htmlFor="swipe-place">
          地名・駅名
        </label>
        <input
          id="swipe-place"
          className={styles.placeInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="横浜駅 / 新宿区"
          autoComplete="off"
        />
        <button type="submit" className={styles.btnPrimary} disabled={busy || query.trim() === ""}>
          {busy ? "探しています…" : "この場所で探す"}
        </button>
      </form>
      <p role="status">{note}</p>
    </Sheet>
  );
}
