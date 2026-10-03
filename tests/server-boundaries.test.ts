import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, expect, it } from "vitest";
import { createServer, type ServerDeps } from "../server";
import fixture from "../e2e/fixtures/shops-boundaries.json" with { type: "json" };
import realShops from "../data/shops.json" with { type: "json" };
import type { AppPayload, Shop } from "../src/lib/types";
import { memoryVisits } from "../src/lib/visits";

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

it("固定fixtureで該当しないキーワードは0件の理由を返す", async () => {
  const server = await connect(fixture as Shop[]);
  const result = await server.call("search-iekei-ramen", { keyword: "存在しない店名ZZZ" });
  expect(result.payload.total).toBe(0);
  expect(result.text).toContain("見つかりませんでした");
});

async function connect(shops?: Shop[], deps: Omit<ServerDeps, "shops"> = {}) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "boundaries", version: "1.0.0" });
  clients.push(client);
  await Promise.all([createServer({ ...deps, shops }).connect(b), client.connect(a)]);
  return {
    client,
    async call(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: args });
      return {
        payload: result.structuredContent as unknown as AppPayload,
        text: (result.content as Array<{ type: string; text: string }>)
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
        isError: result.isError,
      };
    },
  };
}

it("固定 fixture の0件の県を検索・地図・3軒選択で受け付ける", async () => {
  const server = await connect(fixture as Shop[]);
  for (const name of ["search-iekei-ramen", "show-iekei-ramen-map", "decide-iekei-ramen"]) {
    const result = await server.call(name, { prefecture: "秋田県" });
    expect(result.isError).toBeFalsy();
    expect(result.payload.shops).toEqual([]);
    expect(result.payload.total).toBe(0);
    if (name === "show-iekei-ramen-map")
      expect(result.text).toContain("該当する店舗はありませんでした");
  }
});

it("全47県に2軒ずつ存在しても、固定fixtureの境界と混ざらない", async () => {
  const source = await connect([]);
  const { tools } = await source.client.listTools();
  const schema = tools.find((tool) => tool.name === "search-iekei-ramen")!.inputSchema as {
    properties: { prefecture: { enum: string[] } };
  };
  const prefectures = schema.properties.prefecture.enum;
  expect(prefectures).toHaveLength(47);
  const expanded = prefectures.flatMap((prefecture, i) =>
    [0, 1].map((j) => ({
      ...fixture[0],
      id: `expanded/${i}/${j}`,
      prefecture,
    })),
  ) as Shop[];
  const updated = await connect(expanded);
  const map = await updated.call("show-iekei-ramen-map");
  expect(map.payload.total).toBe(94);
  expect(map.payload.prefectures).toHaveLength(47);
  const fixed = await connect(fixture as Shop[]);
  expect((await fixed.call("search-iekei-ramen", { prefecture: "秋田県" })).payload.total).toBe(0);
  expect(
    (await fixed.call("decide-iekei-ramen", { prefecture: "北海道" })).payload.shops,
  ).toHaveLength(1);
  expect(
    (await fixed.call("decide-iekei-ramen", { prefecture: "青森県", round: 1 })).payload.shops,
  ).toHaveLength(1);
});

it("近隣検索・訪問記録・制覇率も同じfixtureを使う", async () => {
  const server = await connect(fixture as Shop[], {
    visitor: { id: "fixture-user" },
    visits: memoryVisits(),
  });
  const nearby = await server.call("find-nearby-iekei-ramen", { lat: 35, lon: 139 });
  expect(nearby.payload.shops.map((shop) => shop.id)).toEqual(
    fixture.slice(0, 5).map((shop) => shop.id),
  );
  expect(nearby.payload.progress?.overall.total).toBe(fixture.length);
  const stamp = await server.call("stamp-iekei-ramen", { shopId: "fixture/0" });
  expect(stamp.payload.progress?.overall.visited).toBe(1);
  const visited = await server.call("show-visited-iekei-ramen");
  expect(visited.payload.shops.map((shop) => shop.id)).toEqual(["fixture/0"]);
  expect(visited.payload.progress?.overall.total).toBe(fixture.length);
});

it("固定 fixture の1件では、モデルに存在しない2軒を選ばせない", async () => {
  const server = await connect(fixture as Shop[]);
  const result = await server.call("decide-iekei-ramen", { prefecture: "北海道" });
  expect(result.payload.shops.map((shop) => shop.id)).toEqual(["fixture/0"]);
  expect(result.payload.decide?.rounds).toBe(1);
  expect(result.text).toContain("1 軒");
  expect(result.text).not.toContain("選ばなかった");
});

it.each([
  { prefecture: "青森県", remaining: 1 },
  { prefecture: "岩手県", remaining: 2 },
])(
  "固定 fixture の $prefecture の最終巡は残り $remaining 件だけを渡す",
  async ({ prefecture, remaining }) => {
    const server = await connect(fixture as Shop[]);
    const first = await server.call("decide-iekei-ramen", { prefecture });
    expect(first.payload.decide?.rounds).toBe(2);
    expect(first.payload.shops).toHaveLength(3);
    expect(first.text).toContain("選ばなかった 2 軒");
    const last = await server.call("decide-iekei-ramen", { prefecture, round: 1 });
    expect(last.payload.shops).toHaveLength(remaining);
    expect(last.text).toContain(`${remaining} 軒`);
    expect(last.text).not.toContain("3 軒まで絞りました");
    if (remaining === 1) expect(last.text).not.toContain("選ばなかった");
    else expect(last.text).toContain("選ばなかった 1 軒");
  },
);

it("fixture を渡したサーバーと本番既定データのサーバーを同時に分離できる", async () => {
  const fixed = await connect(fixture as Shop[]);
  const production = await connect();
  const empty = await connect([]);
  const fixedMap = await fixed.call("show-iekei-ramen-map");
  const realMap = await production.call("show-iekei-ramen-map");
  expect(fixedMap.payload.shops.map((shop) => shop.id)).toEqual(fixture.map((shop) => shop.id));
  expect(realMap.payload.shops.map((shop) => shop.id)).toEqual(realShops.map((shop) => shop.id));
  expect((await empty.call("show-iekei-ramen-map")).payload.total).toBe(0);
});

it("合成データ201件の検索は200件で切り、総件数は201件を返す", async () => {
  const shops = Array.from({ length: 201 }, (_, i) => ({
    ...fixture[0],
    id: `limit/${i}`,
  })) as Shop[];
  const server = await connect(shops);
  const result = await server.call("search-iekei-ramen");
  expect(result.payload.shops.map((shop) => shop.id)).toEqual(
    shops.slice(0, 200).map((shop) => shop.id),
  );
  expect(result.payload.total).toBe(201);
});
