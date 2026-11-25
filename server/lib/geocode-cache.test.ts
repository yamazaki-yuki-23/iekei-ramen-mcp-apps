import { describe, expect, it } from "vitest";
import { geocodeCacheStore } from "./geocode-cache";

/** Cache API の代わり（URL ごとに Response を持つ）。 */
function fakeCache() {
  const map = new Map<string, Response>();
  return {
    map,
    cache: {
      match: async (url: string) => map.get(url)?.clone(),
      put: async (url: string, response: Response) => void map.set(url, response),
    } as unknown as Cache,
  };
}

describe("地名検索の結果の置き場（#427）", () => {
  it("Cache API に、今のサイトの URL の下で、保存期間つきで持つ（KV には書かない）", async () => {
    const { map, cache } = fakeCache();
    const store = geocodeCacheStore("https://iekeiramen.com", cache);
    expect(await store.get("geocode:abc")).toBeNull();
    await store.put("geocode:abc", '[{"label":"横浜駅","lat":35.46,"lon":139.62}]', {
      expirationTtl: 604800,
    });
    const [url] = map.keys();
    expect(url).toBe("https://iekeiramen.com/__cache/geocode/geocode%3Aabc");
    expect(map.get(url)!.headers.get("Cache-Control")).toBe("public, max-age=604800");
    expect(await store.get("geocode:abc")).toBe('[{"label":"横浜駅","lat":35.46,"lon":139.62}]');
  });

  it("Cache API が無いところ（Node）では、持たずに毎回問い合わせる", async () => {
    const store = geocodeCacheStore("http://localhost", undefined);
    await store.put("geocode:abc", "[]", { expirationTtl: 60 });
    expect(await store.get("geocode:abc")).toBeNull();
  });
});
