import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestHarness, unstable_readConfig } from "wrangler";
import { GEOCODE_SPACING_MS } from "../src/lib/geocode-gate";

const { compatibility_date, compatibility_flags } = unstable_readConfig(
  { config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)) },
  { hideWarnings: true },
);
const root = mkdtempSync(join(tmpdir(), "iekei-geocode-gate-"));
const harness = createTestHarness({
  root,
  workers: [
    {
      config: {
        name: "geocode-gate-test",
        main: fileURLToPath(new URL("./fixtures/geocode-gate-worker.ts", import.meta.url)),
        compatibility_date,
        compatibility_flags,
        durable_objects: { bindings: [{ name: "GATE", class_name: "DelayedGate" }] },
        migrations: [{ tag: "v1", new_sqlite_classes: ["DelayedGate"] }],
      },
    },
  ],
});
beforeAll(() => harness.listen(), 60_000);
afterAll(async () => {
  try {
    await harness.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

it("workerdのSQLite保存が遅れても、再生成したGateが1100msを空ける", async () => {
  type Evidence = {
    sentAt: number;
    writes: Array<{ started: number; committed: number; nextFree: number }>;
  };
  const first = await harness.fetch("http://localhost/first");
  expect(first.status).toBe(200);
  const a = (await first.json()) as Evidence;
  expect(a.writes[1].committed - a.writes[1].started).toBeGreaterThanOrEqual(200);
  expect(a.sentAt).toBeGreaterThanOrEqual(a.writes[1].committed);
  // 保存された期限は実送信+1100msより前。新しい実体が保存値を信じると短くなる。
  expect(a.writes[1].nextFree).toBeLessThan(a.sentAt + GEOCODE_SPACING_MS);
  const second = await harness.fetch("http://localhost/second");
  expect(second.status).toBe(200);
  const b = (await second.json()) as Evidence;
  const gap = b.sentAt - a.sentAt;
  console.info(
    JSON.stringify({
      test: "workerd-storage-delay-restart",
      storageDelay: a.writes[1].committed - a.writes[1].started,
      gap,
    }),
  );
  expect(gap).toBeGreaterThanOrEqual(GEOCODE_SPACING_MS);
}, 10_000);
