import type { Client } from "@modelcontextprotocol/client";
import { useEffect, useState } from "react";
import { positionIfGranted } from "../../../lib/browser-position";
import { readPayload } from "../../../utils/payload";
import { webEntry } from "../utils/web-entry";
import type { HostConnectionProps, UiHost } from "../types/host";

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
    // 変数は書き換えず、箱の中身を変える（oxlint の React の規則 immutability）。
    const run: { active: boolean; client?: Client } = { active: true };
    const entry = webEntry(window.location.search);
    /*
     * 接続元から推定する入口（near: "auto"）でも、位置の許可がもう「許可」なら端末の位置で出す
     * （#398）。推定の位置から測った距離で店を選ばせない。問い合わせは出さない。接続と並べて取り、
     * 最初の 3 軒を待たせすぎないよう 3 秒で諦めて推定に戻す。
     */
    const located =
      "near" in entry.arguments && entry.arguments.near === "auto"
        ? positionIfGranted(3_000)
        : Promise.resolve(null);
    const connect = async () => {
      try {
        const { Client, StreamableHTTPClientTransport } = await clientModule;
        if (!run.active) return;
        const client = new Client({ name: "Iekei Ramen Web", version: "0.1.0" });
        run.client = client;
        await client.connect(
          new StreamableHTTPClientTransport(new URL("/mcp", window.location.href)),
        );
        if (!run.active) return;
        const pos = await located;
        if (!run.active) return;
        const result = await client.callTool(
          pos
            ? {
                name: entry.name,
                arguments: {
                  ...entry.arguments,
                  near: undefined,
                  lat: pos.coords.latitude,
                  lon: pos.coords.longitude,
                  label: "現在地",
                  source: "precise",
                },
              }
            : entry,
        );
        if (!run.active) return;
        const payload = readPayload(result);
        if (result.isError || !payload) throw new Error("検索結果を読み込めませんでした。");
        onPayload(payload);
        // 初回結果が遅れてユーザーの検索を上書きしないよう、揃ってから操作を許可する。
        setHost(createWebHost(client));
        setError(null);
      } catch {
        if (run.active)
          setError(new Error("接続できませんでした。ページを再読み込みしてください。"));
      }
    };
    void connect();
    return () => {
      run.active = false;
      void run.client?.close();
    };
  }, [onPayload]);
  return children({ host, error });
}
