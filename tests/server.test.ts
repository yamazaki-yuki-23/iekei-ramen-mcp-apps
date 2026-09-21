/**
 * MCP サーバーの結合テスト。
 * InMemoryTransport でクライアントと直結し、実際の tool 呼び出しを検証する。
 */
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createServer } from "../server";
import type { AppPayload } from "../src/lib/types";

let client: Client;

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client.close();
});

/** structuredContent を AppPayload として取り出す。`meta` はホストが添える _meta。 */
async function callApp(
  name: string,
  args: Record<string, unknown> = {},
  meta?: Record<string, unknown>,
) {
  const result = await client.callTool({ name, arguments: args, ...(meta ? { _meta: meta } : {}) });
  return {
    payload: result.structuredContent as unknown as AppPayload,
    text: (result.content as Array<{ type: string; text: string }>)
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n"),
    isError: result.isError,
  };
}

describe("tool の登録", () => {
  it("UI 付き 3 つと補助 1 つを公開する", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).toSorted()).toEqual([
      "find-nearby-iekei-ramen",
      "geocode-place",
      "search-iekei-ramen",
      "show-iekei-ramen-map",
    ]);
  });

  it("UI 付き tool は同じ UI リソースを指す", async () => {
    const { tools } = await client.listTools();
    const uiTools = tools.filter((t) => t.name !== "geocode-place");
    for (const tool of uiTools) {
      expect((tool._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri).toBe(
        "ui://iekei-ramen/mcp-app.html",
      );
    }
  });
});

describe("UI リソース", () => {
  it("バンドル済みの HTML を返す", async () => {
    const result = await client.readResource({ uri: "ui://iekei-ramen/mcp-app.html" });
    const [content] = result.contents;
    expect(content.text).toMatch(/^<!doctype html>/i);
    expect((content.text as string).length).toBeGreaterThan(10_000);
  });

  it("地図タイルと位置情報に必要なメタデータを添える", async () => {
    const result = await client.readResource({ uri: "ui://iekei-ramen/mcp-app.html" });
    const meta = result.contents[0]._meta as {
      ui: {
        csp: { resourceDomains: string[]; connectDomains: string[] };
        permissions: Record<string, unknown>;
      };
    };
    expect(meta.ui.csp.resourceDomains).toContain("https://*.tile.openstreetmap.org");
    expect(meta.ui.permissions).toHaveProperty("geolocation");
  });
});

describe("search-iekei-ramen", () => {
  it("条件なしで全国の店舗を返す", async () => {
    const { payload } = await callApp("search-iekei-ramen");
    expect(payload.mode).toBe("form");
    expect(payload.total).toBeGreaterThan(500);
    expect(payload.prefectures.length).toBeGreaterThan(30);
  });

  it("1 回のレスポンスは 200 件までに抑える", async () => {
    const { payload } = await callApp("search-iekei-ramen");
    expect(payload.shops.length).toBe(200);
    expect(payload.total).toBeGreaterThan(payload.shops.length);
  });

  it("都道府県で絞り込む", async () => {
    const { payload } = await callApp("search-iekei-ramen", { prefecture: "神奈川県" });
    expect(payload.shops.length).toBeGreaterThan(0);
    expect(payload.shops.every((s) => s.prefecture === "神奈川県")).toBe(true);
    expect(payload.query.prefecture).toBe("神奈川県");
  });

  it("味の傾向で絞り込む", async () => {
    const { payload } = await callApp("search-iekei-ramen", { taste: "rich" });
    expect(payload.shops.length).toBeGreaterThan(0);
    expect(payload.shops.every((s) => s.taste === "rich")).toBe(true);
  });

  it("キーワードで店名を部分一致検索する", async () => {
    const { payload } = await callApp("search-iekei-ramen", { keyword: "吉村家" });
    expect(payload.shops.some((s) => s.name.includes("吉村家"))).toBe(true);
  });

  it("条件を重ねると結果が狭まる", async () => {
    const { payload: pref } = await callApp("search-iekei-ramen", { prefecture: "神奈川県" });
    const { payload: both } = await callApp("search-iekei-ramen", {
      prefecture: "神奈川県",
      taste: "rich",
    });
    expect(both.total).toBeLessThan(pref.total);
    expect(both.shops.every((s) => s.prefecture === "神奈川県" && s.taste === "rich")).toBe(true);
  });

  it("該当が無ければ 0 件とわかるテキストを返す", async () => {
    const { payload, text } = await callApp("search-iekei-ramen", {
      keyword: "存在しない店名ZZZ",
    });
    expect(payload.total).toBe(0);
    expect(text).toContain("見つかりませんでした");
  });

  it("家系と確定していない店には段階と断り書きを添える", async () => {
    // モデルがこのテキストだけを読む場合があるので、断定させない文言が要る。
    // 鹿児島県は candidate だけなので、必ず一覧に載る。
    const { payload, text } = await callApp("search-iekei-ramen", { prefecture: "鹿児島県" });
    expect(payload.shops.every((s) => s.confidence === "candidate")).toBe(true);
    expect(text).toContain("家系か未判定");
    expect(text).toContain("断定しないでください");
  });

  it("確定した店だけなら断り書きを付けない", async () => {
    const { text } = await callApp("search-iekei-ramen", { keyword: "町田商店" });
    expect(text).not.toContain("断定しないでください");
  });

  it("店舗が 0 件の県も指定できる", async () => {
    const { payload, isError } = await callApp("search-iekei-ramen", { prefecture: "奈良県" });
    expect(isError).toBeFalsy();
    expect(payload.total).toBe(0);
  });

  it("未知の都道府県は拒否する", async () => {
    const { isError } = await callApp("search-iekei-ramen", { prefecture: "中央県" });
    expect(isError).toBe(true);
  });
});

describe("find-nearby-iekei-ramen", () => {
  // 横浜駅
  const origin = { lat: 35.4658, lon: 139.6222 };

  it("既定で 5 件を近い順に返す", async () => {
    const { payload } = await callApp("find-nearby-iekei-ramen", origin);
    expect(payload.mode).toBe("nearby");
    expect(payload.shops).toHaveLength(5);

    const distances = payload.shops.map((s) => s.distanceKm!);
    expect(distances).toEqual(distances.toSorted((a, b) => a - b));
  });

  it("横浜駅の近くに吉村家を含める", async () => {
    const { payload } = await callApp("find-nearby-iekei-ramen", { ...origin, limit: 10 });
    const yoshimuraya = payload.shops.find((s) => s.name.includes("吉村家"));
    expect(yoshimuraya).toBeDefined();
    expect(yoshimuraya!.distanceKm).toBeLessThan(1);
  });

  it("limit で件数を変えられる", async () => {
    const { payload } = await callApp("find-nearby-iekei-ramen", { ...origin, limit: 3 });
    expect(payload.shops).toHaveLength(3);
  });

  it("label を現在地の表示名として引き継ぐ", async () => {
    const { payload, text } = await callApp("find-nearby-iekei-ramen", {
      ...origin,
      label: "横浜駅",
    });
    expect(payload.query.origin).toMatchObject({ ...origin, label: "横浜駅" });
    expect(text).toContain("横浜駅");
  });

  it("店舗が無い離島からでも最寄りを返す", async () => {
    // 南鳥島付近。国内最寄りでも 1000km 以上離れている。
    const { payload } = await callApp("find-nearby-iekei-ramen", { lat: 24.28, lon: 153.98 });
    expect(payload.shops).toHaveLength(5);
    expect(payload.shops[0].distanceKm).toBeGreaterThan(1000);
  });

  it("座標を省略するとホストが渡す現在地を使う", async () => {
    // ChatGPT はアプリの iframe に geolocation を許可しないので、
    // ホストが _meta で渡してくる大まかな位置が唯一の手がかりになる。
    const { payload, text } = await callApp(
      "find-nearby-iekei-ramen",
      { limit: 5 },
      {
        "openai/userLocation": {
          latitude: 35.4658,
          longitude: 139.6222,
          city: "横浜市",
          region: "神奈川県",
          country: "JP",
          timezone: "Asia/Tokyo",
        },
      },
    );

    expect(payload.query.origin).toMatchObject({
      lat: 35.4658,
      lon: 139.6222,
      label: "横浜市 神奈川県",
      source: "host",
    });
    expect(payload.shops).toHaveLength(5);
    expect(text).toContain("だいたいの位置");
  });

  it("接続元からの位置照会は環境変数で止められる", () => {
    // 外部通信を伴うので、テストでは vitest.config.ts で空にしている。
    // この前提が崩れると「位置が無い」ケースのテストが実ネットワークを叩く。
    expect(process.env.IEKEI_LOCATION_ENDPOINT).toBe("");
  });

  it("座標もホストの現在地も無ければ空で返し、地名入力を促す", async () => {
    const { payload, text, isError } = await callApp("find-nearby-iekei-ramen", { limit: 5 });

    expect(isError).toBeFalsy();
    expect(payload.query.origin).toBeUndefined();
    expect(payload.shops).toHaveLength(0);
    expect(text).toContain("現在地を特定できませんでした");
    expect(text).toContain("geocode-place");
  });

  it("ホストが座標を文字列で送ってきても使える", async () => {
    // ChatGPT は仕様上 number とされている latitude/longitude を文字列で送ってくる。
    const { payload } = await callApp(
      "find-nearby-iekei-ramen",
      { limit: 3 },
      {
        "openai/userLocation": {
          latitude: "35.4658",
          longitude: "139.6222",
          city: "横浜市",
          region: "神奈川県",
        },
      },
    );

    expect(payload.query.origin).toMatchObject({ lat: 35.4658, lon: 139.6222, source: "host" });
    expect(payload.shops).toHaveLength(3);
  });

  it("ホストの座標が数値として解釈できなければ使わない", async () => {
    const { payload } = await callApp(
      "find-nearby-iekei-ramen",
      { limit: 3 },
      { "openai/userLocation": { latitude: "unknown", longitude: "", city: "横浜市" } },
    );

    expect(payload.query.origin).toBeUndefined();
  });

  it("ホストの座標が範囲外なら使わない", async () => {
    const { payload } = await callApp(
      "find-nearby-iekei-ramen",
      { limit: 3 },
      { "openai/userLocation": { latitude: "999", longitude: "139.6222" } },
    );

    expect(payload.query.origin).toBeUndefined();
  });

  it("ホストの現在地に緯度経度が無ければ使わない", async () => {
    // city だけ来ることがある。座標が無いものは基準地点にできない。
    const { payload } = await callApp(
      "find-nearby-iekei-ramen",
      { limit: 5 },
      { "openai/userLocation": { city: "横浜市", timezone: "Asia/Tokyo" } },
    );

    expect(payload.query.origin).toBeUndefined();
    expect(payload.shops).toHaveLength(0);
  });

  it("引数の座標はホストの現在地より優先される", async () => {
    const { payload } = await callApp(
      "find-nearby-iekei-ramen",
      { lat: 35.4658, lon: 139.6222, limit: 3 },
      { "openai/userLocation": { latitude: 43.06, longitude: 141.35, city: "札幌市" } },
    );

    expect(payload.query.origin).toMatchObject({ lat: 35.4658, source: "precise" });
  });

  it("地名から解決した座標は source=place として記録される", async () => {
    const { payload } = await callApp("find-nearby-iekei-ramen", {
      ...origin,
      label: "横浜駅",
      source: "place",
    });

    expect(payload.query.origin).toMatchObject({ label: "横浜駅", source: "place" });
  });

  it("緯度経度が範囲外なら拒否する", async () => {
    const { isError } = await callApp("find-nearby-iekei-ramen", { lat: 100, lon: 139 });
    expect(isError).toBe(true);
  });

  it("limit の上限を超える指定を拒否する", async () => {
    const { isError } = await callApp("find-nearby-iekei-ramen", { ...origin, limit: 999 });
    expect(isError).toBe(true);
  });
});

describe("show-iekei-ramen-map", () => {
  it("全国の店舗を件数制限なしで返す", async () => {
    const { payload } = await callApp("show-iekei-ramen-map");
    expect(payload.mode).toBe("map");
    expect(payload.shops.length).toBe(payload.total);
    expect(payload.shops.length).toBeGreaterThan(500);
  });

  it("都道府県で絞り込む", async () => {
    const { payload } = await callApp("show-iekei-ramen-map", { prefecture: "東京都" });
    expect(payload.shops.every((s) => s.prefecture === "東京都")).toBe(true);
  });

  it("一覧を出さないので、テキストに内訳と断り書きを添える", async () => {
    // 地図モードは店舗を列挙しないため、件数だけだと未判定の店まで
    // 家系だと断定して伝わってしまう
    const { text } = await callApp("show-iekei-ramen-map");
    expect(text).toContain("内訳");
    expect(text).toContain("家系か未判定");
    expect(text).toContain("断定しないでください");
  });

  it("確定した店だけなら断り書きを付けない", async () => {
    const { payload, text } = await callApp("show-iekei-ramen-map", { taste: "rich" });
    expect(payload.shops.every((s) => s.confidence === "confirmed")).toBe(true);
    expect(text).not.toContain("断定しないでください");
  });

  it("該当が無ければ 0 件とわかるテキストを返す", async () => {
    const { text } = await callApp("show-iekei-ramen-map", { prefecture: "奈良県" });
    expect(text).toContain("該当する店舗はありませんでした");
  });

  it("すべての店舗が地図に描ける座標を持つ", async () => {
    const { payload } = await callApp("show-iekei-ramen-map");
    for (const shop of payload.shops) {
      expect(shop.lat).toBeGreaterThan(20);
      expect(shop.lat).toBeLessThan(46);
      expect(shop.lon).toBeGreaterThan(122);
      expect(shop.lon).toBeLessThan(154);
    }
  });
});

describe("データの整合性", () => {
  it("店舗 ID が一意である", async () => {
    const { payload } = await callApp("show-iekei-ramen-map");
    const ids = payload.shops.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("すべての店舗が必須フィールドを持つ", async () => {
    const { payload } = await callApp("show-iekei-ramen-map");
    for (const shop of payload.shops) {
      expect(shop.name).toBeTruthy();
      expect(shop.prefecture).toBeTruthy();
      expect(["confirmed", "likely", "candidate"]).toContain(shop.confidence);
      expect(["rich", "creamy", "chain", "unknown"]).toContain(shop.taste);
    }
  });

  it("UI に渡す都道府県は実際に店舗がある県だけにする", async () => {
    const { payload } = await callApp("show-iekei-ramen-map");
    const actual = new Set(payload.shops.map((s) => s.prefecture));
    expect(new Set(payload.prefectures)).toEqual(actual);
  });
});
