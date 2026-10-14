import type { McpUiDisplayMode, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useCallback, useEffect } from "react";
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
  /** 広げたい画面を出しているか。地図モードだけ true。 */
  wanted: boolean,
): FullscreenControl | undefined {
  const displayMode = hostContext?.displayMode ?? "inline";
  const expanded = displayMode === "fullscreen";

  const onToggle = useCallback(() => {
    void onDisplayMode(expanded ? "inline" : "fullscreen");
  }, [expanded, onDisplayMode]);

  /*
   * **広げる対象が消えたら畳む。**
   *
   * 畳む釦は地図モードにしか無い。全画面のまま別のタブへ移ると釦ごと消え、
   * ホストは全画面のままなのにアプリ内から戻せなくなる（実測: タブを押しても
   * 枠は 688px のまま）。モデルが別の tool を呼んで画面が変わったときも同じ
   * なので、押した場所ではなく「いま広げる対象があるか」で畳む。
   */
  useEffect(() => {
    if (!wanted && expanded) void onDisplayMode("inline");
  }, [expanded, onDisplayMode, wanted]);

  if (!hostContext?.availableDisplayModes?.includes("fullscreen")) return undefined;
  return { expanded, onToggle };
}
