import type { CallToolResult } from "@modelcontextprotocol/client";
import type { AppPayload, VisitResult } from "./types";
import type { VisitSummary } from "./progress";

/** UI が何も受け取っていないときの土台。 */
export const EMPTY_PAYLOAD: AppPayload = {
  mode: "form",
  shops: [],
  total: 0,
  query: {},
  prefectures: [],
};

/** tool の結果から structuredContent を取り出す。形が違えば null。 */
export function readPayload(result: CallToolResult): AppPayload | null {
  const sc = result.structuredContent as unknown;
  if (!sc || typeof sc !== "object" || !("shops" in sc)) return null;
  return sc as AppPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isProgress(value: unknown): boolean {
  return (
    isRecord(value) &&
    ["visited", "total", "percent"].every(
      (key) => typeof value[key] === "number" && Number.isFinite(value[key]),
    )
  );
}

function isVisitSummary(value: unknown): value is VisitSummary {
  return (
    isRecord(value) &&
    isProgress(value.overall) &&
    Array.isArray(value.prefectures) &&
    value.prefectures.every(
      (item: unknown) => isRecord(item) && typeof item.prefecture === "string" && isProgress(item),
    )
  );
}

/** 記録更新専用。軽量応答を検索結果として読ませず、壊れたsnapshotも成功にしない。 */
export function readVisitResult(result: CallToolResult): VisitResult | null {
  const value = result.structuredContent as unknown;
  if (
    result.isError ||
    !isRecord(value) ||
    !Array.isArray(value.visited) ||
    !value.visited.every((id: unknown) => typeof id === "string") ||
    !isVisitSummary(value.progress)
  )
    return null;
  if ("shops" in value) {
    if (
      value.mode !== "visited" ||
      !Array.isArray(value.shops) ||
      typeof value.total !== "number" ||
      !Number.isFinite(value.total) ||
      !isRecord(value.query) ||
      !Array.isArray(value.prefectures) ||
      !value.prefectures.every((name: unknown) => typeof name === "string")
    )
      return null;
    return readPayload(result);
  }
  if (Object.keys(value).some((key) => key !== "visited" && key !== "progress")) return null;
  return { visited: value.visited, progress: value.progress };
}
