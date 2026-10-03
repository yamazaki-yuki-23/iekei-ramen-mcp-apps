import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHarness, unstable_readConfig } from "wrangler";

export function createOAuthHarness(assetsDirectory?: string) {
  const { compatibility_date, compatibility_flags, assets } = unstable_readConfig(
    { config: fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url)) },
    { hideWarnings: true },
  );
  const root = mkdtempSync(join(tmpdir(), "iekei-oauth-"));
  // 本番のbinding・資格情報や個人用.dev.varsは引き継がない。KVとD1は使い捨て。
  const harness = createTestHarness({
    root,
    workers: [
      {
        config: {
          name: "consent-test",
          main: fileURLToPath(new URL("./oauth-worker.ts", import.meta.url)),
          compatibility_date,
          compatibility_flags,
          ...(assetsDirectory ? { assets: { ...assets, directory: assetsDirectory } } : {}),
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
  return {
    harness,
    async close() {
      try {
        await harness.close();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}
