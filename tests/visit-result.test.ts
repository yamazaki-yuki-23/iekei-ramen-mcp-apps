import type { CallToolResult } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { EMPTY_PAYLOAD, readPayload, readVisitResult } from "../src/lib/payload";
import { StampResultSchema } from "../src/lib/schema";

const snapshot = {
  visited: ["node/test"],
  progress: { overall: { visited: 1, total: 2, percent: 50 }, prefectures: [] },
};
const full = { ...EMPTY_PAYLOAD, mode: "visited", ...snapshot };
const result = (value: unknown): CallToolResult => ({
  content: [],
  structuredContent: value as Record<string, unknown>,
});

describe("記録更新と検索結果の読み口", () => {
  it("完全な旧応答と軽量snapshotを区別し、検索に軽量結果を渡さない", () => {
    expect(readVisitResult(result(full))).toEqual(full);
    expect(readPayload(result(full))).toEqual(full);
    expect(readVisitResult(result(snapshot))).toEqual(snapshot);
    expect(readPayload(result(snapshot))).toBeNull();
    expect(StampResultSchema.safeParse(full).success).toBe(true);
    expect(StampResultSchema.safeParse(snapshot).success).toBe(true);
  });

  it.each([
    { visited: [] },
    { ...snapshot, visited: "node/test" },
    { ...snapshot, visited: [42] },
    { ...snapshot, progress: null },
    {
      ...snapshot,
      progress: { overall: { visited: 1, total: 2, percent: "50" }, prefectures: [] },
    },
    { ...snapshot, progress: { ...snapshot.progress, prefectures: [{}] } },
    { ...snapshot, mode: "visited" },
    { ...snapshot, shops: [] },
    { ...full, shops: null },
  ])("壊れた記録更新を成功扱いにしない: %j", (value) => {
    expect(readVisitResult(result(value))).toBeNull();
    expect(StampResultSchema.safeParse(value).success).toBe(false);
  });

  it("エラー応答に記録が載っていても更新しない", () => {
    expect(readVisitResult({ ...result(snapshot), isError: true })).toBeNull();
  });
});
