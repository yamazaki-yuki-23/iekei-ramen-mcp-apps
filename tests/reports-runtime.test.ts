import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestHarness, unstable_readConfig, type TestHarness } from "wrangler";
import { REPORT_ACCEPTED } from "../src/lib/report-accepted";
const { compatibility_date, compatibility_flags } = unstable_readConfig(
  { config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)) },
  { hideWarnings: true },
);
let harness: TestHarness;
let root: string;
let db: D1Database;
const send = (body: unknown, headers = {}) =>
  harness.fetch("http://localhost/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const rows = () => db.prepare("SELECT * FROM reports ORDER BY received_at").all();
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "iekei-reports-"));
  harness = createTestHarness({
    root,
    workers: [
      {
        config: {
          name: "reports-test",
          compatibility_date,
          compatibility_flags,
          main: fileURLToPath(new URL("./fixtures/reports-worker.ts", import.meta.url)),
          d1_databases: [
            {
              binding: "VISITS",
              database_name: "test-reports",
              database_id: "test-reports",
              migrations_dir: fileURLToPath(new URL("../migrations", import.meta.url)),
            },
          ],
        },
      },
    ],
  });
  await harness.listen();
  const worker = harness.getWorker<{ VISITS: D1Database }>();
  await worker.applyD1Migrations("VISITS");
  db = (await worker.getEnv()).VISITS;
}, 30000);
afterEach(async () => {
  try {
    await harness?.close();
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
}, 30000);
it("3種類の匿名報告を保存し、読み取り口は公開しない", async () => {
  for (const kind of ["not-iekei", "closed"]) {
    const response = await send({ kind, shopId: "node/1774529495" });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ message: REPORT_ACCEPTED });
  }
  expect(
    (await send({ kind: "missing", name: "<b>試験家</b>", location: "横浜駅' OR 1=1 --" })).status,
  ).toBe(201);
  const saved = (await rows()).results;
  expect(saved).toHaveLength(3);
  expect(saved[2]).toMatchObject({
    kind: "missing",
    name: "<b>試験家</b>",
    location: "横浜駅' OR 1=1 --",
    shop_id: null,
  });
  expect(Object.keys(saved[0])).toEqual([
    "id",
    "kind",
    "shop_id",
    "name",
    "location",
    "received_at",
  ]);
  expect((await harness.fetch("http://localhost/reports")).status).toBe(405);
});
it("新しい受付時に30日より前だけを消し、訪問記録には触れない", async () => {
  await db
    .prepare(
      "INSERT INTO visits (user_id, shop_id, visited_at) VALUES ('visitor', 'shop', '2000-01-01')",
    )
    .run();
  for (const days of [31, 29]) {
    await db
      .prepare(
        "INSERT INTO reports (id, kind, shop_id, received_at) VALUES (?, 'closed', 'node/1', ?)",
      )
      .bind(`old-${days}`, new Date(Date.now() - days * 86400000).toISOString())
      .run();
  }
  expect((await send({ kind: "missing", name: "試験家", location: "横浜駅" })).status).toBe(201);
  const saved = (await rows()).results;
  expect(saved).toHaveLength(2);
  expect(saved.some((row) => row.id === "old-31")).toBe(false);
  expect(saved.some((row) => row.id === "old-29")).toBe(true);
  expect((await db.prepare("SELECT * FROM visits").all()).results).toHaveLength(1);
});
it("連打制限の失敗理由を返し、DBに保存しない", async () => {
  const response = await send(
    { kind: "closed", shopId: "node/1774529495" },
    { "CF-Connecting-IP": "blocked" },
  );
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("60");
  expect(await response.json()).toMatchObject({ message: expect.stringContaining("1分後") });
  expect((await rows()).results).toEqual([]);
});
it("不明なID・空欄・長すぎる文字・追加フィールドを拒否する", async () => {
  for (const body of [
    { kind: "closed", shopId: "node/999999999" },
    { kind: "missing", name: " ", location: "駅" },
    { kind: "missing", name: "x".repeat(101), location: "駅" },
    { kind: "missing", name: "店", location: "x".repeat(301) },
    { kind: "closed", shopId: "node/1774529495", userId: "secret" },
  ])
    expect((await send(body)).status).toBe(400);
  expect((await send({ kind: "missing", name: "x".repeat(5000), location: "駅" })).status).toBe(
    413,
  );
  expect((await rows()).results).toEqual([]);
});
it("別originの書き込みやJSON以外を拒否する", async () => {
  expect(
    (await send({ kind: "closed", shopId: "node/1774529495" }, { Origin: "https://other.example" }))
      .status,
  ).toBe(403);
  expect(
    (
      await harness.fetch("http://localhost/reports", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "{}",
      })
    ).status,
  ).toBe(415);
});

it("100件を超えた報告を同じ受付日時でも重複・欠落なく取得し、前のページ削除後も進める", async () => {
  const { reportListQuery, reportPage } = await import("../scripts/report-pages.mjs");
  const ids = Array.from(
    { length: 101 },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );
  await db.batch(
    ids.map((id) =>
      db
        .prepare(
          "INSERT INTO reports (id, kind, shop_id, received_at) VALUES (?, 'closed', 'node/1', ?)",
        )
        .bind(id, "2026-10-04T00:00:00.000Z"),
    ),
  );
  const first = (await db.prepare(reportListQuery()).all<{ id: string; received_at: string }>())
    .results;
  expect(first).toHaveLength(100);
  const cursor = reportPage(first).nextCursor;
  expect(cursor).toBeTruthy();
  const nextBeforeDelete = (
    await db.prepare(reportListQuery(cursor)).all<{ id: string; received_at: string }>()
  ).results;
  expect(nextBeforeDelete.map((row) => row.id)).toEqual([ids[100]]);
  // カーソルの行も削除する。消した行の再読込を前提にしたページ送りは壊れる。
  await db.prepare("DELETE FROM reports WHERE id <= ?").bind(first.at(-1)!.id).run();
  const second = (
    await db.prepare(reportListQuery(cursor)).all<{ id: string; received_at: string }>()
  ).results;
  expect(second.map((row) => row.id)).toEqual([ids[100]]);
  expect(new Set([...first, ...second].map((row) => row.id)).size).toBe(101);
  expect(reportPage(second).nextCursor).toBeNull();
  expect(() =>
    reportListQuery(
      Buffer.from(JSON.stringify(["2026-10-04T00:00:00.000Z", "' OR 1=1 --"])).toString(
        "base64url",
      ),
    ),
  ).toThrow("カーソル");
});
