import { useEffect, useRef } from "react";

/*
 * 結果が届いて画面が作り直されたあとの、焦点と読み上げの受け渡し（#156）。
 *
 * IekeiAppInner は payload ごとに key で作り直す（状態を初期化するための設計）。押した
 * ボタンも一緒に消え、待つ間は disabled にもなるので、焦点は body に落ちる。キーボードで
 * 操作していると、次の Tab が画面の先頭からやり直しになる。結果も黙って入れ替わる。
 * どちらも作り直されない外側（IekeiApp）で受け持つ。
 */

const CONTROL = "button, a[href], [role='tab'], input[id], select[id]";

/**
 * 押したものを、作り直したあとの画面で見つけるための名前。**文言が変わるボタンには
 * `data-focus-key` を付ける**（「次の 3 軒を見る」は最後の組で「最初の 3 軒に戻る」になり、
 * 文言で探すと見つからなかった）。
 */
const controlKey = (el: Element) =>
  el.getAttribute("data-focus-key") ??
  (el instanceof HTMLInputElement || el instanceof HTMLSelectElement
    ? `${el.tagName.toLowerCase()}#${el.id}`
    : null) ??
  `${el.tagName}|${el.getAttribute("role") ?? ""}|${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim()}`;

/**
 * 待っているものが無い。サーバーの呼び出し（data-pending-calls）に加えて、呼ぶ前の位置の取得も
 * 待ちに数える（data-busy。main と、自分で待つ部品の両方）。位置の取得は呼び出しの数に入らないので、片方だけでは早く「済んだ」と
 * 見なし、取得に 0.5 秒以上かかると見守りをやめていた。
 */
const settled = () => {
  const main = document.querySelector("main[data-pending-calls]");
  // main の data-busy に加え、中の部品が自分で待っているもの（「現在地から」の位置の取得）も見る。
  return (
    main?.getAttribute("data-pending-calls") === "0" &&
    !document.querySelector('[data-busy="true"]')
  );
};

/** ページの見出しへ焦点を送る。見出しは押せるものではないので、そのときだけ焦点を受けられるようにする。 */
function focusHeading() {
  const heading = document.querySelector<HTMLElement>("main h1");
  if (!heading) return;
  if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  heading.focus();
}

/** 押してから、呼び出しか作り直しが始まるのを待つ長さ。始まらなければ見守りをやめる。 */
const GRACE_MS = 500;

/** 押したあと、焦点を見守る長さ。応答が遅い回線でも届くまでの間をまかなう。 */
const WATCH_MS = 30_000;

/**
 * キーボードで押したボタンへ、作り直しのあとに焦点を戻す。
 *
 * **マウスで押したときは動かさない。** Enter・Space で押したボタンの click は `detail` が 0、
 * マウスは 1 以上になるので、それで見分ける。入力欄で Enter を押したときは、その欄へ戻す。
 *
 * **描画ではなく、押したあとの数十秒を毎フレーム見る。** 焦点が消える経路は、待つ間の
 * disabled・応答での作り直し・探し方を変えたときの置き場所の移動と、外側の描画を伴わない
 * ものもある。焦点が body に落ちていたら、押せる状態の同じボタンへ戻す。利用者が自分で
 * 別の場所へ移したら、そこで見守りをやめる（移した先を奪わない）。
 */
export function useKeyboardFocusReturn() {
  useEffect(() => {
    let frame = 0;
    const stop = () => cancelAnimationFrame(frame);
    const watchFrom = (control: Element) => {
      stop();
      const key = controlKey(control);
      const until = performance.now() + WATCH_MS;
      // 押したあとにサーバーを呼んだか。呼ばずにその場で入れ替わる釦（「記録を全部消す」→
      // 「本当に全部消す」）は、消えても見出しへ運ばない。そこには次に押すものが出ている。
      let called = false;
      // 応答が 1 フレームで返ると待ちを見逃すので、結果ごと作り直された（main が替わった）ことでも知る。
      const mainAtPress = document.querySelector("main");
      /*
       * 押してから少しの間に呼び出しも作り直しも始まらなければ、結果は入れ替わらない
       * （店の札・探し方の切り替えなど）。そこで見守りをやめる。続けると 30 秒の間、毎フレーム
       * 回り続ける。探し方の切り替えで焦点が消えるのは押した直後なので、この間に戻せる。
       */
      const graceUntil = performance.now() + GRACE_MS;
      const watch = () => {
        const replaced = document.querySelector("main") !== mainAtPress;
        if (!settled() || replaced) called = true;
        if (!called && performance.now() > graceUntil) return;
        /*
         * 焦点がこの文書の外（会話の中ならホストの入力欄など）へ移ったら、利用者が自分で
         * 移した。待っている間にホストへ移った焦点を、結果が届いたときに奪い返さない。
         */
        if (!document.hasFocus()) return;
        const active = document.activeElement;
        /*
         * 押したものそのものか、押せない状態のものに焦点があるうちは待つ。待つ間は文言が
         * 変わる（「発券する」→「発券中…」）ので、名前ではなく要素で比べる。それ以外に
         * 焦点があれば、利用者が自分で移した。
         */
        const waiting = active === control || (active as HTMLButtonElement | null)?.disabled;
        if (active && active !== document.body && !waiting) return;
        // その場で済んだ（「行った」など）。焦点は押したものに残っているので、見守る理由が無い。
        if (active === control && called && settled() && !replaced) return;
        if (active === document.body || !active) {
          const target = [...document.querySelectorAll<HTMLElement>(CONTROL)].find(
            (el) => controlKey(el) === key && !(el as HTMLButtonElement).disabled,
          );
          if (target) target.focus();
          else if (called && !control.isConnected && settled()) {
            /*
             * 押したものが、うまくいくと消えるもの（「もう一度試す」「このキーワードを外す」）
             * だったら、戻す先が無い。呼び出しが済んでも見つからなければ、ページの見出しへ送る。
             * 次の Tab が画面の先頭からやり直しにならず、見出しの読み上げで結果も伝わる。
             */
            focusHeading();
            return;
          }
        }
        if (performance.now() < until) frame = requestAnimationFrame(watch);
      };
      frame = requestAnimationFrame(watch);
    };
    const onClick = (event: MouseEvent) => {
      const control = event.target instanceof Element ? event.target.closest(CONTROL) : null;
      // 入力欄で Enter を押したときのフォームの送信も click になる。欄の方を追っているので譲る。
      if (document.activeElement instanceof HTMLInputElement && event.detail === 0) return;
      if (!control || event.detail !== 0) return stop();
      watchFrom(control);
    };
    /*
     * 結果を探し直す入力欄の Enter（「現在地から」の地名欄・店名の欄）。click は起きないので、
     * キーで受ける。結果が届くと欄ごと作り直されるので、同じ欄へ戻す。
     *
     * **`data-result-input` を付けた欄だけ。** 報告の欄のように結果を差し替えない欄まで追うと、
     * 送信で欄が消えたときに、出たばかりの「受け取りました」ではなく見出しへ焦点を運んでいた。
     */
    let byKey = false;
    const onKeyDown = (event: KeyboardEvent) => {
      byKey = true;
      const field = event.target;
      if (event.key === "Enter" && field instanceof HTMLInputElement && field.dataset.resultInput)
        watchFrom(field);
    };
    /*
     * 選んだ時点で結果を差し替える選択欄（地図の都道府県。#165）。change には detail が
     * 無いので、直前の入力がキーから来たかで見分ける。マウスで開いて選んだときは、
     * 直前が pointerdown になる。
     */
    const onPointer = () => (byKey = false);
    const onChange = (event: Event) => {
      const field = event.target;
      if (byKey && field instanceof Element && field.matches("select[data-result-input]"))
        watchFrom(field);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("change", onChange, true);
    return () => {
      stop();
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("change", onChange, true);
    };
  }, []);
}

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
