import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { createServer } from "../server";
import data from "../data/shops.json";
import { readPayload } from "../src/lib/payload";
import { memoryVisits } from "../src/lib/visits";

const visitor = { id: "snapshot-test" };

async function connect(visits = memoryVisits()) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "snapshot-test", version: "1" });
  await Promise.all([
    createServer({ visitor, visits }).connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

describe("スタンプの訪問snapshot", () => {
  it("既定は全店舗を返し、明示した軽量応答も同じ訪問IDと制覇率を返す", async () => {
    const ids = data.slice(0, 100).map((shop) => shop.id);
    const client = await connect(memoryVisits({ [visitor.id]: ids }));
    try {
      const full = await client.callTool({
        name: "stamp-iekei-ramen",
        arguments: { shopId: ids[0] },
      });
      expect(readPayload(full)?.shops.map((shop) => shop.id)).toEqual(ids);
      const light = await client.callTool({
        name: "stamp-iekei-ramen",
        arguments: { shopId: ids[0], includeShops: false },
      });
      expect(light.isError).not.toBe(true);
      expect(light.structuredContent).toEqual({
        visited: full.structuredContent!.visited,
        progress: full.structuredContent!.progress,
      });
      // 検索結果を差し替える読み口には軽量応答を渡さない。
      expect(readPayload(light)).toBeNull();
      const history = await client.callTool({ name: "show-visited-iekei-ramen" });
      expect(readPayload(history)?.shops.map((shop) => shop.id)).toEqual(ids);
    } finally {
      await client.close();
    }
  });

  it.each([true, false])("includeShops=%sでも書いた後に1回だけ記録を読む", async (includeShops) => {
    let reads = 0;
    const visits = {
      ...memoryVisits(),
      list: async () => (++reads === 1 ? [data[0].id] : [data[0].id, data[1].id]),
    };
    const client = await connect(visits);
    try {
      const result = await client.callTool({
        name: "stamp-iekei-ramen",
        arguments: { shopId: data[0].id, includeShops },
      });
      expect(reads).toBe(1);
      expect(result.structuredContent?.visited).toEqual([data[0].id]);
      expect(result.structuredContent?.progress).toMatchObject({ overall: { visited: 1 } });
      if (includeShops)
        expect(readPayload(result)?.shops.map((shop) => shop.id)).toEqual([data[0].id]);
      else expect(result.structuredContent).not.toHaveProperty("shops");
    } finally {
      await client.close();
    }
  });
});
