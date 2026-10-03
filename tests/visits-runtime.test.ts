import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestHarness, unstable_readConfig, type TestHarness } from "wrangler";

// 本番configから読むのは互換設定だけ。binding・資格情報・保存先は引き継がない。
const { compatibility_date, compatibility_flags } = unstable_readConfig(
  {
    config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
  },
  { hideWarnings: true },
);
let harness: TestHarness;
let root: string;
let db: D1Database;

async function call(action: "list" | "set" | "clear", visitorId: string, extra = {}) {
  const response = await harness.fetch("http://localhost/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, visitorId, ...extra }),
  });
  expect(response.status).toBe(200);
  return response.json();
}
const set = (visitorId: string, shopId: string, visited = true) =>
  call("set", visitorId, { shopId, visited });
const list = (visitorId: string) => call("list", visitorId);
const rows = () =>
  db
    .prepare("SELECT user_id, shop_id, visited_at FROM visits ORDER BY user_id, shop_id")
    .all<{ user_id: string; shop_id: string; visited_at: string }>();

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "iekei-visits-"));
  harness = createTestHarness({
    root,
    workers: [
      {
        config: {
          name: "visits-test",
          compatibility_date,
          compatibility_flags,
          main: fileURLToPath(new URL("./fixtures/visits-worker.ts", import.meta.url)),
          d1_databases: [
            {
              binding: "VISITS",
              database_name: "test-visits",
              database_id: "test-db",
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
  // 各テストで別のDBを作る。同じ利用者・店IDを使い回しても前の記録が残らない。
  expect((await rows()).results).toEqual([]);
}, 30_000);

afterEach(async () => {
  try {
    await harness?.close();
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

it("実migrationのスキーマと複合主キーを使い、空の一覧を返す", async () => {
  const schema = await db
    .prepare("PRAGMA table_info(visits)")
    .all<{ name: string; notnull: number; pk: number }>();
  expect(schema.results.map(({ name, notnull, pk }) => ({ name, notnull, pk }))).toEqual([
    { name: "user_id", notnull: 1, pk: 1 },
    { name: "shop_id", notnull: 1, pk: 2 },
    { name: "visited_at", notnull: 1, pk: 0 },
  ]);
  const migrations = await db.prepare("SELECT name FROM d1_migrations").all<{ name: string }>();
  expect(migrations.results).toContainEqual({ name: "0001_visits.sql" });
  expect(await list("visitor-a")).toEqual([]);
});

it("押した店をD1へ保存し、一覧をIDの配列で返す", async () => {
  expect(await set("visitor-a", "shop-1")).toBe(true);
  expect(await set("visitor-a", "shop-2")).toBe(true);
  expect(((await list("visitor-a")) as string[]).toSorted()).toEqual(["shop-1", "shop-2"]);
  for (const row of (await rows()).results) {
    expect(row.user_id).toBe("visitor-a");
    expect(row.visited_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isFinite(Date.parse(row.visited_at))).toBe(true);
  }
});

it("同じ店を再登録しても初回日時と他の利用者の記録を保持する", async () => {
  const firstVisit = "2001-02-03T04:05:06.000Z";
  await db
    .prepare("INSERT INTO visits (user_id, shop_id, visited_at) VALUES (?, ?, ?)")
    .bind("visitor-a", "shop-1", firstVisit)
    .run();
  await set("visitor-b", "shop-1");
  const before = (await rows()).results;
  expect(before).toHaveLength(2);
  await set("visitor-a", "shop-1");
  await set("visitor-a", "shop-1");
  expect((await rows()).results).toEqual(before);
  expect(await list("visitor-a")).toEqual(["shop-1"]);
  expect(await list("visitor-b")).toEqual(["shop-1"]);
});

it("外すと指定した人の店だけを削除し、不明な店を外しても壊れない", async () => {
  await set("visitor-a", "shop-1");
  await set("visitor-a", "shop-2");
  await set("visitor-b", "shop-1");
  const other = (await rows()).results.find((row) => row.user_id === "visitor-b");
  expect(other).toBeDefined();
  expect(await set("visitor-a", "shop-1", false)).toBe(false);
  expect(await set("visitor-a", "missing", false)).toBe(false);
  expect(await list("visitor-a")).toEqual(["shop-2"]);
  expect((await rows()).results.find((row) => row.user_id === "visitor-b")).toEqual(other);
});

it("全削除は指定した人だけを消し、SQLの引用符を含む利用者も分離する", async () => {
  const quoted = "user' OR 1=1 --";
  await set("visitor-a", "shop-1");
  await set("visitor-a", "shop-2");
  await set(quoted, "shop-1");
  expect(await list(quoted)).toEqual(["shop-1"]);
  const other = (await rows()).results.find((row) => row.user_id === quoted);
  expect(other).toBeDefined();
  await call("clear", "visitor-a");
  await call("clear", "visitor-a");
  expect(await list("visitor-a")).toEqual([]);
  expect((await rows()).results).toEqual([other]);
  await call("clear", quoted);
  expect((await rows()).results).toEqual([]);
});
