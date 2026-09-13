/**
 * E2E 設定。
 *
 * MCP サーバーと検証ホスト（MCP Apps SDK の basic-host）を両方立ち上げ、
 * 実ブラウザからホスト経由でアプリを操作する。
 * ホストの取得は `npm run e2e:setup` が行う。
 */
import { defineConfig, devices } from "@playwright/test";

const MCP_PORT = 3131;
// basic-host はサンドボックスの origin を http://localhost:8081 に固定して
// ビルドしているため、ホスト側のポートは既定値から変えられない。
const HOST_PORT = 8080;

export default defineConfig({
  testDir: "./e2e",
  // 撮影系は検証ではないので通常実行から外す。
  // capture 系は npm run capture、shoot は pw-shoot.config.ts から動かす。
  testIgnore: ["**/capture*.spec.ts", "**/shoot.spec.ts"],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${HOST_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // 先に UI をビルドしてからサーバーを起動する（server.ts は埋め込み済み HTML を読む）
      command: `npm run build:ui && npx tsx main.ts`,
      env: {
        PORT: String(MCP_PORT),
        // 接続元からの位置推定は実行環境によって結果が変わるので E2E では止める。
        // 「位置情報が取れないホスト」の挙動を決定的に検証したいため。
        IEKEI_LOCATION_ENDPOINT: "",
      },
      url: `http://localhost:${MCP_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // basic-host の start は bun を要求するので、ビルド済みの serve.ts を tsx で直接起動する。
      command: `SERVERS='["http://localhost:${MCP_PORT}/mcp"]' npx tsx e2e-host/ext-apps/examples/basic-host/serve.ts`,
      url: `http://localhost:${HOST_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
