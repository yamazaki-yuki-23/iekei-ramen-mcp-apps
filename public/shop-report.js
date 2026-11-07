/*
 * 店のページの報告（#255）。匿名のまま、アプリと同じ受け口（/reports）へ店の ID と種類だけを送る。
 * 押し間違いを送らないよう、種類を押したらその場で「送る」「やめる」を出して確かめる（#365）。
 * 連打止め: 送っている間と受け取ったあとは、どのボタンも押せない（サーバー側の回数の制限とは別に）。
 * 失敗したときだけ押せる状態に戻し、受け口が返した理由をそのまま出す。
 */
const FAILED = "送信できませんでした。もう一度お試しください";

/** 受け口が返した文（受け取った・断った理由）。読めなければ fallback。 */
const reason = async (response, fallback) => {
  const body = await response.json().catch(() => ({}));
  return typeof body.message === "string" ? body.message : fallback;
};

for (const box of document.querySelectorAll("[data-report-shop]")) {
  const buttons = [...box.querySelectorAll("button[data-kind]")];
  const status = box.querySelector("[role=status]");
  const confirm = box.querySelector(".seo-report-confirm");
  const send = confirm.querySelector("[data-confirm]");
  let pending;
  const settle = (state, message, disabled) => {
    box.dataset.state = state;
    for (const button of buttons) button.disabled = disabled;
    if (status) status.textContent = message;
  };
  /** 確かめている種類を替える（undefined で確かめるのをやめる）。 */
  const choose = (button) => {
    pending?.removeAttribute("aria-pressed");
    pending = button;
    button?.setAttribute("aria-pressed", "true");
    confirm.hidden = !button;
  };
  for (const button of buttons) {
    button.addEventListener("click", () => {
      if (box.dataset.state === "sending" || box.dataset.state === "sent") return;
      settle("confirming", "", false);
      choose(button);
      box.querySelector(".seo-report-question").textContent =
        `「${button.textContent}」として送りますか？`;
      send.focus();
    });
  }
  confirm.querySelector("[data-cancel]").addEventListener("click", () => {
    const back = pending;
    settle("", "", false);
    choose(undefined);
    back?.focus();
  });
  send.addEventListener("click", async () => {
    const button = pending;
    if (!button || box.dataset.state !== "confirming") return;
    confirm.hidden = true;
    settle("sending", "送信中…", true);
    // 押したボタンは隠れるので、焦点は結果を出す行へ移す。
    status?.focus();
    try {
      const response = await fetch("/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: button.dataset.kind, shopId: box.dataset.reportShop }),
      });
      // 失敗のときも受け口は理由を JSON で返す。状態を先に見てから本文を読む。
      if (!response.ok) throw new Error(await reason(response, FAILED));
      settle("sent", await reason(response, "受け取りました。"), true);
    } catch (failure) {
      choose(undefined);
      settle("failed", failure instanceof Error ? failure.message : FAILED, false);
    }
  });
}
