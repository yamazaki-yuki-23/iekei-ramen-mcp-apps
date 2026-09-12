import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // ユニット/結合テストは tests/ だけ。E2E は Playwright が担当する。
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "e2e/**", "e2e-host/**"],
  },
});
