import type { Client } from "@modelcontextprotocol/client";
import { useEffect, useState } from "react";
import { readPayload } from "../lib/payload";
import type { HostConnectionProps, UiHost } from "./types";

function createWebHost(client: Client): UiHost {
  return {
    callServerTool: (params, options) => client.callTool(params, options),
    async openLink({ url }) {
      window.open(url, "_blank", "noopener,noreferrer");
      return {};
    },
    async sendMessage() {
      throw new Error("この操作はMCP Appsの会話から利用できます。");
    },
    async updateModelContext() {
      return {};
    },
    async requestDisplayMode() {
      return { mode: "inline" };
    },
    getHostContext: () => ({ availableDisplayModes: ["inline"] }),
    capabilities: { model: false, visitSignIn: false, reports: true },
  };
}

/** 同じoriginの既存MCPを呼ぶ。検索ロジックはサーバー側のtoolだけが持つ。 */
export function WebConnection({ onPayload, children }: HostConnectionProps) {
  const [host, setHost] = useState<UiHost | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let active = true;
    let client: Client | undefined;
    const connect = async () => {
      try {
        const { Client, StreamableHTTPClientTransport } =
          await import("@modelcontextprotocol/client");
        if (!active) return;
        client = new Client({ name: "Iekei Ramen Web", version: "0.1.0" });
        await client.connect(
          new StreamableHTTPClientTransport(new URL("/mcp", window.location.href)),
        );
        if (!active) return;
        const result = await client.callTool({ name: "decide-iekei-ramen", arguments: {} });
        if (!active) return;
        const payload = readPayload(result);
        if (result.isError || !payload) throw new Error("検索結果を読み込めませんでした。");
        onPayload(payload);
        // 初回結果が遅れてユーザーの検索を上書きしないよう、揃ってから操作を許可する。
        setHost(createWebHost(client));
        setError(null);
      } catch {
        if (active) setError(new Error("接続できませんでした。ページを再読み込みしてください。"));
      }
    };
    void connect();
    return () => {
      active = false;
      void client?.close();
    };
  }, [onPayload]);
  return children({ host, error });
}
