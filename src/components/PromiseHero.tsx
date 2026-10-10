import styles from "../mcp-app.module.css";

/*
 * 和文は 1 文を 1 本の文字列にする（JSX の改行は空白 1 個に畳まれる）。
 * 約束の一言は #50 で決めたもの。言い換えない。
 */
const LEAD = "券売機で選んで、発券。迷ったら、3 軒まで絞ります。";

/** 一言の見出しの id。入口から送る先にも使う。 */
export const APP_HEAD_ID = "app-head";

/**
 * Web の最初の画面の一言（#125・#144）。屋号の太さで大きく置き、すぐ下の券売機へつなぐ。
 * 主な入口は券売機の「発券する」。一言のすぐ下に、家系マッチ（#181）への第 2 ボタンを 1 つだけ置く
 * （券売機より強くしない）。但し書きは券売機の取り出し口の下にある。
 *
 * **位置は求めない。** 開いた瞬間に許可を求めると、何のサイトか分かる前に断られる。
 * 現在地は、券売機で「近くで」を選んで発券したときだけ求める。
 */
export function PromiseHero() {
  return (
    <section className={styles.hero} aria-labelledby="promise">
      <p className={styles.heroCatch} id="promise">
        近くに、
        <br />
        <em>まだ知らない</em>
        <br />
        家系がある。
      </p>
      <div className={styles.heroActions}>
        <a className={styles.buttonSecondary} href="/match/">
          近くの家系とマッチング →
        </a>
      </div>
      <p className={styles.heroLead}>{LEAD}</p>
    </section>
  );
}
