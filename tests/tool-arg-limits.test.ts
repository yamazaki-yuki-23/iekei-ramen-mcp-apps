/**
 * tool の文字列の引数の長さの上限（#429）。上限ちょうどは通り、1 字でも超えたら SDK の引数の検査で
 * 誤りとして返す（0 件の答えにしない）。実際の Nominatim は叩かない（fetch を差し替える）。
 */
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLACE_MAX, TEXT_MAX } from "../server/lib/schema";
import { memoryVisits } from "../server/lib/visits";
import { createServer } from "../server/server";
import type { ServerDeps } from "../server/types/deps";

async function connect(deps: ServerDeps = {}) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([createServer(deps).connect(b), client.connect(a)]);
  return (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args }).catch((error: unknown) => ({
      isError: true,
      thrown: String(error),
    }));
}

const text = (n: number) => "家".repeat(n);
/** SDK の引数の検査で断られたか（tool の中まで届いて誤りになったのとは分ける）。 */
const rejected = (result: unknown) => JSON.stringify(result).includes("Input validation error");

afterEach(() => vi.unstubAllGlobals());

describe("tool の文字列の引数の上限（#429）", () => {
  it("地名検索の query は 300 字まで。超えたら Nominatim へ出さずに誤りを返す", async () => {
    const fetchMock = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);
    const call = await connect();
    expect(rejected(await call("geocode-place", { query: text(PLACE_MAX + 1) }))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rejected(await call("geocode-place", { query: text(PLACE_MAX) }))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("キーワードは 100 字まで（Web の入口と同じ）", async () => {
    const call = await connect();
    for (const name of ["search-iekei-ramen", "show-iekei-ramen-map", "decide-iekei-ramen"]) {
      expect(rejected(await call(name, { keyword: text(TEXT_MAX + 1) })), name).toBe(true);
      expect(rejected(await call(name, { keyword: text(TEXT_MAX) })), name).toBe(false);
    }
  });

  it("基準地点の表示名は 300 字まで（地名検索の表示名がそのまま入る）", async () => {
    const call = await connect();
    const at = { lat: 35.4658, lon: 139.6222 };
    for (const name of ["find-nearby-iekei-ramen", "show-iekei-ramen-map", "decide-iekei-ramen"]) {
      expect(rejected(await call(name, { ...at, label: text(PLACE_MAX + 1) })), name).toBe(true);
      expect(rejected(await call(name, { ...at, label: text(PLACE_MAX) })), name).toBe(false);
    }
  });

  it("行った印の店舗 ID は 100 字まで", async () => {
    const call = await connect({
      visitor: { id: "limits" },
      visits: memoryVisits({}),
    });
    expect(rejected(await call("stamp-iekei-ramen", { shopId: "n".repeat(TEXT_MAX + 1) }))).toBe(
      true,
    );
    // 上限の中なら、引数の検査は通る（ID が無い店なので、tool の中で見つからないと答える）。
    expect(rejected(await call("stamp-iekei-ramen", { shopId: "n".repeat(TEXT_MAX) }))).toBe(false);
  });
});
