/** 実データと実MCP toolによる、応答JSON全体のUTF-8サイズ比較。HTTP/SSE/圧縮は含めない。 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import data from "../../data/shops.json" with { type: "json" };
import { createServer } from "../../server/server.ts";
import { memoryVisits } from "../../server/lib/visits.ts";

const visitor = { id: "benchmark-only" };
/** stamp-iekei-ramen の structuredContent のうち、ここで比べる欄。 */
type StampContent = { shops?: unknown[]; visited?: unknown; progress?: unknown };
const contentOf = (result: { structuredContent?: unknown }) =>
  result.structuredContent as StampContent;
for (const initialVisits of [0, 100, data.length]) {
  const visits = memoryVisits({
    [visitor.id]: data.slice(0, initialVisits).map((shop) => shop.id),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "stamp-benchmark", version: "1" });
  try {
    await Promise.all([
      createServer({ visitor, visits }).connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const full = await client.callTool({
      name: "stamp-iekei-ramen",
      arguments: { shopId: data[0].id },
    });
    const light = await client.callTool({
      name: "stamp-iekei-ramen",
      arguments: { shopId: data[0].id, includeShops: false },
    });
    assert.notEqual(full.isError, true);
    assert.notEqual(light.isError, true);
    assert.equal(contentOf(light).shops, undefined);
    assert.deepEqual(contentOf(light).visited, contentOf(full).visited);
    assert.deepEqual(contentOf(light).progress, contentOf(full).progress);
    const fullBytes = Buffer.byteLength(JSON.stringify(full));
    const lightBytes = Buffer.byteLength(JSON.stringify(light));
    assert.ok(lightBytes < fullBytes);
    console.log(
      JSON.stringify({
        initialVisits,
        returnedShops: contentOf(full).shops!.length,
        fullBytes,
        lightBytes,
        savedPercent: Number(((1 - lightBytes / fullBytes) * 100).toFixed(2)),
      }),
    );
  } finally {
    await client.close();
  }
}
