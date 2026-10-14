import { useEffect, useRef } from "react";

/*
 * 結果が届いて画面が作り直されたあとの、焦点と読み上げの受け渡し（#156）。
 *
 * SearchAppInner は payload ごとに key で作り直す（状態を初期化するための設計）。押した
 * ボタンも一緒に消え、待つ間は disabled にもなるので、焦点は body に落ちる。キーボードで
 * 操作していると、次の Tab が画面の先頭からやり直しになる。結果も黙って入れ替わる。
 * どちらも作り直されない外側（SearchApp）で受け持つ。
 */
/**
 * 結果が変わったら、見出しと件数を読み上げる文にする。**payload ごと差し替えたときだけでなく、
 * 記録を消したときのようにその場で書き換えたときも読む**（payload の参照で見る）。
 *
 * **読み上げの領域は作り直されない側に置く。** 作り直す中に `role="status"` を置くと、
 * 中身と一緒に生まれるので、読み上げられないことが多い。読む文は画面の
 * `[data-announce]`（見出し・件数・「迷ったら」の題と何軒目か）から取り、画面と同じにする。
 * 1 つずつ「。」で終える。読み上げの区切りになり、画面の行と文字列が完全には重ならない
 * （E2E は行末までの一致で画面の行を探している）。
 */
export function useResultAnnouncement(payloadVersion: number, payload: unknown) {
  const region = useRef<HTMLParagraphElement>(null);
  const last = useRef<{ version: number; text: string } | null>(null);
  useEffect(() => {
    if (payload == null || !region.current) return;
    const text = [...document.querySelectorAll<HTMLElement>("[data-announce]")]
      // 画面の文と別に読ませたいもの（0 件など）は data-announce-text に書く。
      .map((el) => (el.dataset.announceText ?? el.textContent ?? "").trim())
      .filter(Boolean)
      .map((part) => `${part}。`)
      .join("");
    /*
     * **結果ごと差し替えたら必ず読み、その場の書き換えは文が変わったときだけ読む。**
     * 差し替え（payloadVersion が増える）は新しく探した結果なので、見出しと件数が前と同じ
     * でも読む（店名の違う 1 軒どうしなど）。記録を押したときは payload をその場で作り直す
     * だけで、見出しも件数も変わらない。そこで読むと、探し直したように古い見出しを読む。
     * 最初の表示は覚えるだけで読まない。
     */
    const previous = last.current;
    last.current = { version: payloadVersion, text };
    if (!previous) return;
    if (previous.version === payloadVersion && previous.text === text) return;
    // 画面の外の DOM（読み上げの領域）へ書くだけなので、state にせず直接書く。
    region.current.textContent = text;
  }, [payloadVersion, payload]);
  return region;
}
