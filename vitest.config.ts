import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 1 つのソースを確かめる単体テストはソースの隣、結合テストは tests/（#222）。E2E は Playwright。
    include: ["tests/**/*.test.ts", "src/**/*.test.ts", "server/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "e2e/**", "e2e-host/**"],
    // 接続元の位置照会は外部通信なのでテストでは行わない。
    // ホスト由来の位置が無いケースを純粋に検証したいので空にする。
    env: { IEKEI_LOCATION_ENDPOINT: "" },
  },
});
