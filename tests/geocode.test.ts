/**
 * geocode-place が Nominatim の利用ポリシーを守るか。
 * 実際の Nominatim は叩かない（fetch を差し替える）。
 */
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, normalizePlaceQuery, type ServerDeps } from "../server";

const YOKOHAMA = [{ display_name: "横浜駅, 西区, 横浜市", lat: "35.466", lon: "139.622" }];

function stubNominatim(body: unknown = YOKOHAMA, status = 200) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json(body, { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** KV の鍵の上限（512 バイト）も本物に合わせる。超えると本番の KV は例外を投げる。 */
function checkKey(k: string) {
  const bytes = new TextEncoder().encode(k).length;
  if (bytes > 512) throw new Error(`KV key too long: ${bytes}`);
}

function memoryKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string) => (checkKey(k), store.get(k) ?? null),
    put: async (k: string, v: string) => (checkKey(k), void store.set(k, v)),
  } as unknown as NonNullable<ServerDeps["geocodeCache"]> & { store: Map<string, string> };
}

async function connect(deps: ServerDeps) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([createServer(deps).connect(b), client.connect(a)]);
  return (query: string) => client.callTool({ name: "geocode-place", arguments: { query } });
}

afterEach(() => vi.unstubAllGlobals());

describe("geocode-place", () => {
  it.each(["get", "put"] as const)("KV の %s が失敗しても取得した座標を返す", async (operation) => {
    const fetchMock = stubNominatim();
    const cache = memoryKv();
    vi.spyOn(cache, operation).mockRejectedValue(new Error("internal KV failure"));
    const result = await (await connect({ geocodeCache: cache }))("横浜駅");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      results: [{ label: "横浜駅, 西区, 横浜市", lat: 35.466, lon: 139.622 }],
    });
    expect(JSON.stringify(result)).not.toContain("internal KV failure");
  });

  it.each(["get", "put"] as const)("KV の %s が失敗しても 0 件を正常に返す", async (operation) => {
    const fetchMock = stubNominatim([]);
    const cache = memoryKv();
    vi.spyOn(cache, operation).mockRejectedValue(new Error("internal KV failure"));
    const result = await (await connect({ geocodeCache: cache }))("よこはまえきx");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).toContain("見つかりませんでした");
  });

  it.each(["{", "{}", '[{"label":"駅","lat":null,"lon":139}]'])(
    "壊れたキャッシュ %s は通常の送り口から取得し直す",
    async (cached) => {
      const directFetch = stubNominatim();
      const cache = memoryKv();
      vi.spyOn(cache, "get").mockResolvedValue(cached);
      const allow = vi.fn(async () => true);
      const gateway = vi.fn(async () => Response.json(YOKOHAMA));
      const result = await (
        await connect({
          geocodeCache: cache,
          allowGeocode: allow,
          nominatim: gateway,
        })
      )("横浜駅");
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toHaveProperty("results.0.lat", 35.466);
      expect(allow).toHaveBeenCalledTimes(1);
      expect(gateway).toHaveBeenCalledTimes(1);
      expect(directFetch).not.toHaveBeenCalled();
    },
  );

  it("KV の読み書き障害でも許可後は全体の送り口から検索する", async () => {
    const directFetch = stubNominatim();
    const cache = memoryKv();
    vi.spyOn(cache, "get").mockRejectedValue(new Error("internal KV read failure"));
    vi.spyOn(cache, "put").mockRejectedValue(new Error("internal KV write failure"));
    const allow = vi.fn(async () => true);
    const gateway = vi.fn(async () => {
      expect(allow).toHaveBeenCalledTimes(1);
      return Response.json(YOKOHAMA);
    });
    const result = await (
      await connect({
        geocodeCache: cache,
        allowGeocode: allow,
        nominatim: gateway,
      })
    )("横浜駅");
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toHaveProperty("results.0.lat", 35.466);
    expect(gateway).toHaveBeenCalledTimes(1);
    expect(directFetch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("internal KV");
  });

  it("KV の読み取り障害でも連打止めを通し、拒否時は外部へ送らない", async () => {
    const fetchMock = stubNominatim();
    const cache = memoryKv();
    vi.spyOn(cache, "get").mockRejectedValue(new Error("internal KV failure"));
    const allow = vi.fn(async () => false);
    const gateway = vi.fn(async () => Response.json(YOKOHAMA));
    const result = await (
      await connect({
        geocodeCache: cache,
        allowGeocode: allow,
        nominatim: gateway,
      })
    )("横浜駅");
    expect(allow).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(gateway).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("待って");
    expect(JSON.stringify(result)).not.toContain("internal KV failure");
  });

  it("同じ地名の 2 回目は Nominatim を叩かない（表記の揺れも同じ鍵）", async () => {
    const fetchMock = stubNominatim();
    const geocode = await connect({ geocodeCache: memoryKv() });

    const first = await geocode("横浜駅");
    const second = await geocode("  横浜駅 ");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.structuredContent).toEqual(first.structuredContent);
  });

  it("見つからなかった地名も持つ。打ち間違いの連打を流さない", async () => {
    const fetchMock = stubNominatim([]);
    const geocode = await connect({ geocodeCache: memoryKv() });

    await geocode("よこはまえきx");
    const again = await geocode("よこはまえきx");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(again.isError).toBeFalsy();
  });

  it("連打止めに掛かったら Nominatim に届く前に止め、理由を返す", async () => {
    const fetchMock = stubNominatim();
    const geocode = await connect({ allowGeocode: async () => false });

    const result = await geocode("横浜駅");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("待って");
  });

  it("キャッシュで答えられるなら、連打止めは数えない", async () => {
    stubNominatim();
    const cache = memoryKv();
    await (
      await connect({ geocodeCache: cache })
    )("横浜駅");

    const allow = vi.fn(async () => false);
    const result = await (await connect({ geocodeCache: cache, allowGeocode: allow }))("横浜駅");
    expect(allow).not.toHaveBeenCalled();
    expect(result.isError).toBeFalsy();
  });

  it("失敗した応答は持たない。次は問い合わせ直す", async () => {
    const cache = memoryKv();
    stubNominatim({}, 503);
    const failed = await (await connect({ geocodeCache: cache }))("横浜駅");
    expect(failed.isError).toBe(true);
    expect(cache.store.size).toBe(0);
  });

  it("長い住所でも KV の鍵の上限を超えない", async () => {
    // 和文は 1 字 3 バイト。180 字で 540 バイトになり、そのまま鍵にすると落ちていた。
    const fetchMock = stubNominatim();
    const geocode = await connect({ geocodeCache: memoryKv() });
    const result = await geocode("神奈川県横浜市西区".repeat(20));
    expect(result.isError).toBeFalsy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("User-Agent にアプリと連絡先を名乗る", async () => {
    const fetchMock = stubNominatim();
    await (
      await connect({})
    )("横浜駅");
    const ua = new Headers(fetchMock.mock.calls[0][1]?.headers).get("User-Agent");
    expect(ua).toMatch(/^iekei-ramen-mcp-apps\/\S+ \(\+https:\/\/github\.com\//);
  });
});

describe("normalizePlaceQuery", () => {
  it("全角の英数・空白と前後の空白を畳む", () => {
    expect(normalizePlaceQuery("　横浜駅　　西口 ")).toBe("横浜駅 西口");
    expect(normalizePlaceQuery("ＪＲ新宿")).toBe("JR新宿");
  });
});
