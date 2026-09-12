/**
 * README・スライド用のスクリーンショットと動画を撮るための設定。
 *
 * 通常の E2E 設定は capture.spec.ts を除外しているので（CI で回す必要がないため）、
 * 撮影のときだけこちらを使う。サーバーの起動条件は E2E と同じ。
 */
import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: ["capture.spec.ts", "capture-demo.spec.ts"],
});
