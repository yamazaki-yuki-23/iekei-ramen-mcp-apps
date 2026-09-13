import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // ユニット/結合テストは tests/ だけ。E2E は Playwright が担当する。
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "e2e/**", "e2e-host/**"],
    // 接続元の位置照会は外部通信なのでテストでは行わない。
    // ホスト由来の位置が無いケースを純粋に検証したいので空にする。
    env: { IEKEI_LOCATION_ENDPOINT: "" },
  },
});
