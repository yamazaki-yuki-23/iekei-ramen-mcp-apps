import type { Client } from "@modelcontextprotocol/client";
import { useEffect, useState } from "react";
import { readPayload } from "../lib/payload";
import { webEntry } from "../lib/web-entry";
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

/*
 * **MCP クライアントは、このファイルが読まれた時点で取りに行く**（#154）。effect の中で
 * 読むと、最初の JS の取得・実行・初回描画が終わるまで取得が始まらず、その後に /mcp の
 * 往復が直列に並んでいた（モバイル実測: 1632ms に JS が届き、取得の開始は 1743ms）。
 * 接続の手順と「結果が揃ってから操作を許可する」順序は変えない。
 */
const clientModule = import("@modelcontextprotocol/client");
// 失敗は接続のときに受けて画面に出す。ここで受けておかないと、未処理の拒否として報告される。
clientModule.catch(() => {});

/** 同じoriginの既存MCPを呼ぶ。検索ロジックはサーバー側のtoolだけが持つ。 */
export function WebConnection({ onPayload, children }: HostConnectionProps) {
  const [host, setHost] = useState<UiHost | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let active = true;
    let client: Client | undefined;
    const connect = async () => {
      try {
        const { Client, StreamableHTTPClientTransport } = await clientModule;
        if (!active) return;
        client = new Client({ name: "Iekei Ramen Web", version: "0.1.0" });
        await client.connect(
          new StreamableHTTPClientTransport(new URL("/mcp", window.location.href)),
        );
        if (!active) return;
        const result = await client.callTool(webEntry(window.location.search));
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
