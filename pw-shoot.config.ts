import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["shoot.spec.ts"],
  timeout: 120_000,
  // 撮影結果（動画）を消さないよう、出力先を分けておく
  outputDir: "./test-results-shoot",
  reporter: "line",
  use: { viewport: { width: 1280, height: 720 } },
});
