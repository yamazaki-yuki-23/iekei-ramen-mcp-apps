import { z } from "zod";

export const REPORT_ACCEPTED = "受け取りました。反映は確認してからなので時間がかかります";
const existing = { shopId: z.string().trim().min(1).max(100) };
export const ReportSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("not-iekei"), ...existing }),
  z.strictObject({ kind: z.literal("closed"), ...existing }),
  z.strictObject({
    kind: z.literal("missing"),
    name: z.string().trim().min(1).max(100),
    location: z.string().trim().min(1).max(300),
  }),
]);
export type ShopReport = z.infer<typeof ReportSchema>;

/** 受付と期限切れの削除を同じトランザクションで実行する。IPは保存しない。 */
export async function receiveReport(db: D1Database, report: ShopReport, now = new Date()) {
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare("DELETE FROM reports WHERE received_at < ?")
      .bind(new Date(now.getTime() - 30 * 86400000).toISOString()),
    db
      .prepare(
        "INSERT INTO reports (id, kind, shop_id, name, location, received_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id,
        report.kind,
        "shopId" in report ? report.shopId : null,
        "name" in report ? report.name : null,
        "location" in report ? report.location : null,
        now.toISOString(),
      ),
  ]);
  return id;
}
