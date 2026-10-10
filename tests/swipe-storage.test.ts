import { afterEach, describe, expect, it, vi } from "vitest";

// 日本の利用者の暦で数える（#166）。UTC で日付を作ると朝 9 時に「今日」が変わる。
process.env.TZ = "Asia/Tokyo";
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
} as Storage;
const { addMet, localDay, loadWants, saveWants } = await import("../src/swipe/storage");

describe("今日出会った数の日付", () => {
  it("日本時間の 0 時を過ぎたら、その日の日付になる（UTC の前日にしない）", () => {
    expect(localDay(new Date("2026-10-10T15:30:00Z"))).toBe("2026-10-11"); // 日本時間 0:30
    expect(localDay(new Date("2026-10-10T14:30:00Z"))).toBe("2026-10-10"); // 日本時間 23:30
  });
});

describe("行きたいリスト", () => {
  it("距離は残さない（選んだときの基準地点に依るので、開き直した場所で測り直す）", () => {
    const shop = {
      id: "node/1",
      name: "試験家",
      taste: "unknown",
      confidence: "confirmed",
      prefecture: "神奈川県",
      lat: 35.4,
      lon: 139.6,
      osmUrl: "x",
      distanceKm: 1.2,
    } as const;
    saveWants([shop]);
    expect(JSON.parse(store.get("iekei-swipe-wants")!)[0]).not.toHaveProperty("distanceKm");
    expect(loadWants()[0]).not.toHaveProperty("distanceKm");
    expect(loadWants()[0].name).toBe("試験家");
  });
});

describe("今日出会った数", () => {
  afterEach(() => vi.useRealTimers());
  it("開いたまま 0 時を越えても、前の日の数に足さない", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T14:50:00Z")); // 日本時間 23:50
    store.delete("iekei-swipe-met");
    for (let i = 0; i < 5; i++) addMet(1);
    expect(addMet(0)).toBe(5);
    vi.setSystemTime(new Date("2026-10-10T15:10:00Z")); // 日本時間 0:10（翌日）
    expect(addMet(1)).toBe(1);
  });
});
