import { expect, it } from "vitest";
import { frameLocation } from "../e2e/frame-location";

it.each([
  [
    "https://user:credential@example.com/app?token=credential#credential",
    "https://example.com/app",
  ],
  ["http://localhost:3133/app?token=credential", "http://localhost:3133/app"],
  ["about:blank", "about:blank"],
  ["about:srcdoc", "about:srcdoc"],
  ["about:credential", "about:"],
  ["data:text/html,<p>credential</p>", "data:"],
  ["data:text/html;base64,Y3JlZGVudGlhbA==", "data:"],
  ["javascript:alert('credential')", "javascript:"],
  ["blob:https://example.com/credential", "blob:"],
  ["file:///private/credential", "file:"],
  ["not a URL credential", "unknown"],
])("フレーム位置 %s の本文・認証値を保存しない", (url, expected) => {
  expect(frameLocation(url)).toBe(expected);
});
