import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { ReactNode } from "react";
import type { AppPayload } from "../lib/types";

/** 共有画面が使うホストの契約。SDKのAppインスタンスはMCP側の実装だけが持つ。 */
export type UiHost = Pick<
  App,
  | "callServerTool"
  | "openLink"
  | "sendMessage"
  | "updateModelContext"
  | "requestDisplayMode"
  | "getHostContext"
> & {
  capabilities: {
    model: boolean;
    visitSignIn: boolean;
    reports?: boolean;
  };
};

export interface HostConnectionProps {
  onPayload: (payload: AppPayload) => void;
  onContextChange: (context: McpUiHostContext) => void;
  children: (connection: { host: UiHost | null; error: Error | null }) => ReactNode;
}
