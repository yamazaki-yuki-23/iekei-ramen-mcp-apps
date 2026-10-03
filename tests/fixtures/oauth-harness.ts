import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";

export function createOAuthHarness() {
  // 本番config・個人用.dev.varsを読み込まない。KVとD1は使い捨てのローカル環境。
  return createTestHarness({
    root: mkdtempSync(join(tmpdir(), "iekei-consent-")),
    workers: [
      {
        config: {
          name: "consent-test",
          main: fileURLToPath(new URL("./oauth-worker.ts", import.meta.url)),
          compatibility_date: "2026-09-22",
          compatibility_flags: ["nodejs_compat"],
          kv_namespaces: [{ binding: "OAUTH_KV", id: "test-kv" }],
          d1_databases: [
            {
              binding: "VISITS",
              database_name: "test-visits",
              database_id: "test-db",
              migrations_dir: fileURLToPath(new URL("../../migrations", import.meta.url)),
            },
          ],
          vars: {
            GOOGLE_CLIENT_ID: "test-client",
            GOOGLE_CLIENT_SECRET: "test-secret",
            VISITOR_ID_PEPPER: "local-test-pepper",
          },
        },
      },
    ],
  });
}
