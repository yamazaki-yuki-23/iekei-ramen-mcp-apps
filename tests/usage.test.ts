/**
 * 使われているかを数える部分（src/lib/usage.ts）。
 *
 * **書く項目に、個人を特定できるものが入らないこと**を確かめる。IP・生の `sub`・
 * 訪問者の id・検索した地名・座標・店は書かない。
 */
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { createServer } from "../server";
import { COUNTED_TOOLS, recordUsage, toDataPoint, usageEvent } from "../src/lib/usage";

/** 書かれたものを貯める、偽の Analytics Engine。 */
function fakeDataset() {
  const points: AnalyticsEngineDataPoint[] = [];
  return {
    points,
    dataset: { writeDataPoint: (p?: AnalyticsEngineDataPoint) => p && points.push(p) },
  };
}

describe("usageEvent — 何を数えるか", () => {
  it("tool 名とサインインの有無を取り出す", () => {
    expect(usageEvent("search-iekei-ramen", {}, false)).toEqual({
      tool: "search-iekei-ramen",
      signedIn: false,
    });
  });

  it("知らない tool 名は数えない", () => {
    /*
     * 本文の tool 名は呼ぶ側が自由に書ける。そのまま書くと、地名のような任意の
     * 文字列まで計測に入る。
     */
    expect(usageEvent("横浜駅", {}, false)).toBeNull();
  });

  it("スタンプは、押したか外したかだけを持つ", () => {
    expect(usageEvent("stamp-iekei-ramen", { shopId: "node/1", visited: false }, true)).toEqual({
      tool: "stamp-iekei-ramen",
      signedIn: true,
      stamp: "unvisited",
    });
  });
});

describe("toDataPoint — 書く項目に、個人を特定できるものが無い", () => {
  it("引数（地名・座標・都道府県・店）を書かない", () => {
    const secrets = ["横浜駅", "35.4657", "139.622", "神奈川県", "node/604269583"];
    const events = [
      usageEvent("geocode-place", { query: "横浜駅" }, false),
      usageEvent("find-nearby-iekei-ramen", { lat: 35.4657, lon: 139.622 }, false),
      usageEvent("search-iekei-ramen", { prefecture: "神奈川県", keyword: "横浜駅" }, false),
      usageEvent("stamp-iekei-ramen", { shopId: "node/604269583", visited: true }, true),
    ];
    expect(events.every(Boolean)).toBe(true);
    const written = JSON.stringify(events.map((e) => e && toDataPoint(e)));
    for (const secret of secrets)
      expect(written, `「${secret}」を書いている`).not.toContain(secret);
  });

  it("書くのは tool 名・サインインの有無・スタンプの向き・件数だけ", () => {
    const point = toDataPoint({ tool: "stamp-iekei-ramen", signedIn: true, stamp: "visited" });
    expect(point).toEqual({
      indexes: ["stamp-iekei-ramen"],
      blobs: ["stamp-iekei-ramen", "member", "visited"],
      doubles: [1],
    });
  });
});

describe("recordUsage — 書けなくても検索を止めない", () => {
  it("binding が無ければ何もしない（手元の Node サーバー）", () => {
    expect(() =>
      recordUsage(undefined, { tool: "search-iekei-ramen", signedIn: false }),
    ).not.toThrow();
  });

  it("書き込みが投げても、外へは投げない", () => {
    const dataset = {
      writeDataPoint: () => {
        throw new Error("over the limit");
      },
    };
    expect(() =>
      recordUsage(dataset, { tool: "search-iekei-ramen", signedIn: false }),
    ).not.toThrow();
  });

  it("数えない呼び出し（null）は書かない", () => {
    const { points, dataset } = fakeDataset();
    recordUsage(dataset, null);
    expect(points).toEqual([]);
  });
});

describe("数える tool の一覧", () => {
  it("サーバーの tool と食い違わない", async () => {
    /*
     * tool を足したのにここへ足し忘れると、その tool は黙って数えられない。
     * 消したのに残っていても気付けないので、両方向で突き合わせる。
     */
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    await client.close();
    expect([...COUNTED_TOOLS].toSorted()).toEqual(tools.map((t) => t.name).toSorted());
  });
});
