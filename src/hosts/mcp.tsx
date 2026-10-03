import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useMemo } from "react";
import { readPayload } from "../lib/payload";
import type { HostConnectionProps, UiHost } from "./types";

/** ホストの初期化・通知と、thisが必要なSDKメソッドをこの境界で受ける。 */
export function McpConnection({ onPayload, onContextChange, children }: HostConnectionProps) {
  const { app, error } = useApp({
    appInfo: { name: "Iekei Ramen Finder", version: "0.1.0" },
    capabilities: {},
    onAppCreated: (instance) => {
      instance.ontoolresult = async (result) => {
        const next = readPayload(result);
        if (next) onPayload(next);
      };
      instance.onhostcontextchanged = onContextChange;
      instance.onerror = console.error;
      instance.onteardown = async () => ({});
    },
  });
  const host = useMemo<UiHost | null>(
    () =>
      app
        ? {
            callServerTool: (params, options) => app.callServerTool(params, options),
            openLink: (params, options) => app.openLink(params, options),
            sendMessage: (params, options) => app.sendMessage(params, options),
            updateModelContext: (params, options) => app.updateModelContext(params, options),
            requestDisplayMode: (params, options) => app.requestDisplayMode(params, options),
            getHostContext: () => app.getHostContext(),
            capabilities: { model: true, visitSignIn: true },
          }
        : null,
    [app],
  );
  return children({ host, error });
}
