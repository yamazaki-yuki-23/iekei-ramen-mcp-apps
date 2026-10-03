import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestHarness } from "wrangler";

const harness = createTestHarness({
  root: mkdtempSync(join(tmpdir(), "iekei-geocode-")),
  workers: [
    {
      config: {
        name: "geocode-test",
        main: fileURLToPath(new URL("./fixtures/geocode-worker.ts", import.meta.url)),
        compatibility_date: "2026-09-22",
        compatibility_flags: ["nodejs_compat"],
        durable_objects: { bindings: [{ name: "GEOCODE_GATE", class_name: "GeocodeGate" }] },
        migrations: [{ tag: "v1", new_sqlite_classes: ["GeocodeGate"] }],
      },
    },
  ],
});

beforeAll(async () => {
  await harness.listen();
}, 30_000);
afterAll(async () => {
  await harness.close();
}, 30_000);

it.each(["headers", "body"])(
  "workerd の %s 待ちを中止し、同時検索と再試行を完了する",
  async (phase) => {
    const request = () => harness.fetch(`http://localhost/${phase}`);
    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.status)).toEqual([504, 504]);
    const again = await request();
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ calls: 2, aborted: true });
  },
  20_000,
);
