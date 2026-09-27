/**
 * 訪問スタンプの結合テスト。
 *
 * **D1 は立てない。** 同じ形の偽物（memoryVisits）に差し替えて、tool の筋だけを見る。
 * SQL そのものは `d1Visits` の中だけにあり、ここでは関心の対象外。
 */
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { createServer } from "../server";
import type { AppPayload } from "../src/lib/types";
import { memoryVisits } from "../src/lib/visits";

const VISITOR = { id: "visitor-1" };

async function connect(deps: Parameters<typeof createServer>[0]) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([createServer(deps).connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    async call(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: args });
      return {
        payload: result.structuredContent as unknown as AppPayload,
        text: (result.content as Array<{ type: string; text: string }>)
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n"),
        isError: result.isError,
      };
    },
  };
}

/** 実データの先頭 2 件。ID は固定なので、テストの前提にできる。 */
const shopsData = (await import("../data/shops.json", { with: { type: "json" } }))
  .default as Array<{
  id: string;
  name: string;
}>;
const [first, second] = shopsData;

describe("訪問スタンプ", () => {
  it("押すと記録され、制覇率に出る", async () => {
    const { call, client } = await connect({ visitor: VISITOR, visits: memoryVisits() });

    const { payload, text } = await call("stamp-iekei-ramen", { shopId: first.id });

    expect(payload.visited).toEqual([first.id]);
    expect(payload.progress?.overall.visited).toBe(1);
    expect(text).toContain(first.name);
    await client.close();
  });

  it("現在地が分からないときの返事でも、サインイン済みのままに見える", async () => {
    /*
     * 位置を何も渡せないと find-nearby は早期に返る。その道が payload の出口を
     * 通っていないと visited が落ち、UI はサインインしている人を匿名として扱う
     * （記録の釦がサインインの依頼に変わる）。
     */
    const { call, client } = await connect({
      visitor: VISITOR,
      visits: memoryVisits({ [VISITOR.id]: [first.id] }),
    });

    const { payload } = await call("find-nearby-iekei-ramen", { limit: 5 });

    expect(payload.query.origin).toBeUndefined();
    expect(payload.visited).toEqual([first.id]);
    await client.close();
  });

  it("応答は 1 つの時点だけで組む（読み直さない）", async () => {
    /*
     * 別のホストから同じ人が押すと、1 回の応答の中で記録が変わりうる。
     * 読み直すと**一覧は前の時点・バッジと制覇率は後の時点**という応答になり、
     * 「行った店として並んでいるのにバッジが付いていない」が起きる。
     *
     * ここでは「読むたびに増える」記録置き場で、その混ざりを再現する。
     */
    let reads = 0;
    const shifting = {
      ...memoryVisits(),
      list: async () => {
        reads += 1;
        return reads === 1 ? [first.id] : [first.id, second.id];
      },
    };
    const { call, client } = await connect({ visitor: VISITOR, visits: shifting });

    const { payload } = await call("show-visited-iekei-ramen");

    // 一覧と記録が同じ時点のものであること（どちらの時点でも、揃っていればよい）。
    expect(payload.shops.map((shop) => shop.id)).toEqual(payload.visited);
    expect(payload.progress?.overall.visited).toBe(payload.visited?.length);
    await client.close();
  });

  it("データから消えた店しか記録が無くても、モデルに「記録が無い」と言わない", async () => {
    /*
     * 記録は店舗 ID で持つので、データを取り直して店が消えると一覧から落ちる。
     * 並んでいる数で文を決めると、**記録が残っているのに「まだ 1 軒も記録が
     * ありません」**とモデルへ伝え、構造化データ（visited）と食い違う。
     */
    const { call, client } = await connect({
      visitor: VISITOR,
      visits: memoryVisits({ [VISITOR.id]: ["node/ghost-1", "node/ghost-2"] }),
    });

    const { payload, text } = await call("show-visited-iekei-ramen");

    expect(payload.shops).toHaveLength(0);
    expect(payload.visited).toHaveLength(2);
    expect(text).not.toContain("まだ 1 軒も記録がありません");
    // 画面に出るものと同じ説明を渡す。
    expect(text).toContain("店舗データ");
    await client.close();
  });

  it("同じ店を 2 回押しても 1 軒のまま", async () => {
    // 押し直しはふつうに起きる操作。壊れないこと。
    const { call, client } = await connect({ visitor: VISITOR, visits: memoryVisits() });

    await call("stamp-iekei-ramen", { shopId: first.id });
    const { payload } = await call("stamp-iekei-ramen", { shopId: first.id });

    expect(payload.visited).toEqual([first.id]);
    await client.close();
  });

  it("外すと消える", async () => {
    const { call, client } = await connect({
      visitor: VISITOR,
      visits: memoryVisits({ [VISITOR.id]: [first.id] }),
    });

    const { payload } = await call("stamp-iekei-ramen", { shopId: first.id, visited: false });

    expect(payload.visited).toEqual([]);
    expect(payload.progress?.overall.visited).toBe(0);
    await client.close();
  });

  it("知らない店 ID は記録しない", async () => {
    // 消えた店のゴミが溜まると、制覇率の分母と合わなくなる。
    const { call, client } = await connect({ visitor: VISITOR, visits: memoryVisits() });

    const { isError, text } = await call("stamp-iekei-ramen", { shopId: "存在しない" });

    expect(isError).toBe(true);
    expect(text).toContain("見つかりませんでした");
    await client.close();
  });

  it("一覧はその人の記録だけを返す", async () => {
    const { call, client } = await connect({
      visitor: VISITOR,
      visits: memoryVisits({ [VISITOR.id]: [first.id], 別の人: [second.id] }),
    });

    const { payload } = await call("show-visited-iekei-ramen");

    expect(payload.shops.map((s) => s.id)).toEqual([first.id]);
    await client.close();
  });

  it("記録がゼロでも失敗にしない", async () => {
    const { call, client } = await connect({ visitor: VISITOR, visits: memoryVisits() });

    const { text, isError, payload } = await call("show-visited-iekei-ramen");

    expect(isError).toBeFalsy();
    expect(text).toContain("まだ 1 軒も");
    expect(payload.progress?.overall.percent).toBe(0);
    await client.close();
  });

  it("全部消せる", async () => {
    const { call, client } = await connect({
      visitor: VISITOR,
      visits: memoryVisits({ [VISITOR.id]: [first.id, second.id] }),
    });

    const { payload } = await call("forget-my-iekei-ramen-visits");

    expect(payload.visited).toEqual([]);
    await client.close();
  });

  it("匿名には visited を入れない（空配列と区別するため）", async () => {
    /*
     * 空配列を入れてしまうと、UI から見て「サインイン済みで 0 軒」と
     * 見分けが付かず、スタンプの導線を出す判断ができない。
     */
    const { call, client } = await connect({});

    const { payload } = await call("search-iekei-ramen", { prefecture: "神奈川県" });

    expect(payload.visited).toBeUndefined();
    expect(payload.progress).toBeUndefined();
    await client.close();
  });

  it("サインインしていれば検索結果にも visited が乗る", async () => {
    const { call, client } = await connect({
      visitor: VISITOR,
      visits: memoryVisits({ [VISITOR.id]: [first.id] }),
    });

    const { payload } = await call("search-iekei-ramen", { prefecture: "神奈川県" });

    expect(payload.visited).toEqual([first.id]);
    await client.close();
  });
});
