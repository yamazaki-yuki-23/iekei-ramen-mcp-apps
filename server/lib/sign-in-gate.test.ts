import { describe, expect, it, vi } from "vitest";
import { countUp, DAILY_LIMITS, SignInGate } from "./sign-in-gate";

/** Durable Object の保存領域の代わり。書いた回数も数える。 */
function memory() {
  const map = new Map<string, unknown>();
  const put = vi.fn(async (key: string, value: unknown) => void map.set(key, value));
  return { storage: { get: async (key: string) => map.get(key), put } as never, put };
}

describe("サインインの入口の 1 日の上限（#427）", () => {
  it("今日の分を数え、上限に届いたら数えない。日が変わったら数え直す", () => {
    expect(countUp(undefined, "2026-11-26", 2)).toEqual({ day: "2026-11-26", count: 1 });
    expect(countUp({ day: "2026-11-26", count: 1 }, "2026-11-26", 2)).toEqual({
      day: "2026-11-26",
      count: 2,
    });
    expect(countUp({ day: "2026-11-26", count: 2 }, "2026-11-26", 2)).toBeNull();
    expect(countUp({ day: "2026-11-25", count: 2 }, "2026-11-26", 2)).toEqual({
      day: "2026-11-26",
      count: 1,
    });
  });

  it("上限までは通して 1 回ずつ保存し、超えたら 429 で、保存も書かない", async () => {
    const { storage, put } = memory();
    const gate = new SignInGate({ storage });
    const ask = () => gate.fetch(new Request("https://sign-in-gate/authorize"));
    for (let i = 0; i < DAILY_LIMITS.authorize; i++) expect((await ask()).status).toBe(204);
    expect(put).toHaveBeenCalledTimes(DAILY_LIMITS.authorize);
    expect((await ask()).status).toBe(429);
    expect((await ask()).status).toBe(429);
    // 断るときに書くと、こちらの保存の枠を連打で使わせることになる。
    expect(put).toHaveBeenCalledTimes(DAILY_LIMITS.authorize);
    // 入口ごとに別に数える。
    expect((await gate.fetch(new Request("https://sign-in-gate/register"))).status).toBe(204);
    expect((await gate.fetch(new Request("https://sign-in-gate/other"))).status).toBe(400);
  });

  it("1 つの接続元が両方を使い切っても、KV の書き込みは 1 日 1,000 件の枠に収まる", () => {
    // 許可画面は最後まで進むと 1 回で最大 5 件、登録は 1 回で 1 件（sign-in-gate.ts の計算）。
    expect(DAILY_LIMITS.authorize * 5 + DAILY_LIMITS.register).toBeLessThanOrEqual(1000);
  });
});
