import type { CallToolResult } from "@modelcontextprotocol/client";
import type { AppPayload } from "./types";

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
