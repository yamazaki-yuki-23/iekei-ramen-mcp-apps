import type { McpUiDisplayMode, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useCallback } from "react";
import type { FullscreenControl } from "../components/MapToolbar";

/**
 * 地図の全画面化。
 *
 * **使えないホストでは undefined を返し、釦ごと出さない。** 押しても何も
 * 起きない釦は、壊れているのか自分の操作が悪いのか分からない。
 *
 * 今どちらのモードかは hostContext から読む。要求した側で覚えておくと、
 * ホストが別のモードを返したときに画面とずれる。
 */
export function useFullscreen(
  hostContext: McpUiHostContext | undefined,
  onDisplayMode: (mode: McpUiDisplayMode) => Promise<void>,
): FullscreenControl | undefined {
  const displayMode = hostContext?.displayMode ?? "inline";
  const expanded = displayMode === "fullscreen";

  const onToggle = useCallback(() => {
    void onDisplayMode(expanded ? "inline" : "fullscreen");
  }, [expanded, onDisplayMode]);

  if (!hostContext?.availableDisplayModes?.includes("fullscreen")) return undefined;
  return { expanded, onToggle };
}
