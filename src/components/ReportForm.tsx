import { useId, useState, type SubmitEvent } from "react";
import { REPORT_ACCEPTED, type ShopReport } from "../lib/reports";
import styles from "../mcp-app.module.css";

export function ReportEntry({
  enabled,
  ready = true,
  shopId,
}: {
  enabled?: boolean;
  ready?: boolean;
  shopId?: string;
}) {
  if (!enabled || !ready) return null;
  return <ReportForm shopId={shopId} />;
}

function ReportForm({ shopId }: { shopId?: string }) {
  const id = useId();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [error, setError] = useState("");
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending" || state === "sent") return;
    const data = new FormData(event.currentTarget);
    const report: ShopReport = shopId
      ? { kind: data.get("kind") === "closed" ? "closed" : "not-iekei", shopId }
      : {
          kind: "missing",
          name: String(data.get("name") ?? ""),
          location: String(data.get("location") ?? ""),
        };
    setState("sending");
    try {
      const response = await fetch("/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      });
      if (!response.ok) {
        const body: unknown = await response.json();
        throw new Error(
          body && typeof body === "object" && "message" in body && typeof body.message === "string"
            ? body.message
            : "送信できませんでした。もう一度お試しください",
        );
      }
      setState("sent");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "送信できませんでした。もう一度お試しください",
      );
      setState("failed");
    }
  }
  return (
    <details className={styles.report}>
      <summary className={styles.reportSummary}>
        {shopId ? "店舗情報を報告する" : "お探しの家系が見つからないときは"}
      </summary>
      {state === "sent" ? (
        <div className={styles.reportForm}>
          <p role="status">{REPORT_ACCEPTED}</p>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() => {
              setState("idle");
              setError("");
            }}
          >
            {shopId ? "別の内容を報告する" : "別の店舗を報告する"}
          </button>
        </div>
      ) : (
        <form className={styles.reportForm} onSubmit={(event) => void submit(event)}>
          <p className={styles.selectedNote}>
            サインインは不要です。個人情報は書かないでください。
          </p>
          {shopId ? (
            <label className={styles.reportField} htmlFor={`${id}-kind`}>
              報告の種類
              <select
                className={styles.select}
                id={`${id}-kind`}
                name="kind"
                disabled={state === "sending"}
              >
                <option value="not-iekei">家系ではない</option>
                <option value="closed">閉店している</option>
              </select>
            </label>
          ) : (
            <>
              <label className={styles.reportField} htmlFor={`${id}-name`}>
                店名
                <input
                  className={styles.input}
                  id={`${id}-name`}
                  name="name"
                  required
                  maxLength={100}
                  disabled={state === "sending"}
                />
              </label>
              <label className={styles.reportField} htmlFor={`${id}-location`}>
                場所（駅名や住所）
                <input
                  className={styles.input}
                  id={`${id}-location`}
                  name="location"
                  required
                  maxLength={300}
                  disabled={state === "sending"}
                />
              </label>
            </>
          )}
          <button type="submit" className={styles.buttonSecondary} disabled={state === "sending"}>
            {state === "sending" ? "送信中…" : "報告を送信"}
          </button>
          {state === "failed" && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </details>
  );
}
