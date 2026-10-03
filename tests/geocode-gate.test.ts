import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GEOCODE_MAX_WAIT_MS,
  GEOCODE_SPACING_MS,
  GeocodeGate,
  reserveSlot,
} from "../src/lib/geocode-gate";

describe("reserveSlot", () => {
  it("空いていればすぐ通し、次の枠を 1 間隔あとに置く", () => {
    expect(reserveSlot(0, 10_000)).toEqual({ wait: 0, next: 10_000 + GEOCODE_SPACING_MS });
  });

  it("待ちが上限を超えるなら断る", () => {
    expect(reserveSlot(10_000 + GEOCODE_MAX_WAIT_MS + 1, 10_000)).toBeNull();
  });
});

/** Durable Object の保存領域の代わり。作り直しても中身が残る。 */
function memoryStorage() {
  const store = new Map<string, unknown>();
  return {
    storage: {
      get: async (k: string) => store.get(k),
      put: async (k: string, v: unknown) => void store.set(k, v),
    } as never,
  };
}

const T0 = 50_000;
const ask = (gate: GeocodeGate, q: string) =>
  gate.fetch(new Request(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}`));

/** Nominatim の代わり。いつ送られてきたか（止めた時計の上で）を記録する。 */
function stubNominatim(status = 200) {
  const sentAt: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => (sentAt.push(Date.now() - T0), Response.json([], { status }))),
  );
  return sentAt;
}

describe("GeocodeGate", () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(["headers", "body"] as const)(
    "%s が止まっても同時検索を期限で終え、同じ地名を再試行できる",
    async (phase) => {
      let signal: AbortSignal | undefined;
      const upstream = vi.fn(async (request: Request) => {
        if (upstream.mock.calls.length > 1) return Response.json([]);
        signal = request.signal;
        if (phase === "headers") return new Promise<Response>(() => {});
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("["));
              request.signal.addEventListener(
                "abort",
                () => controller.error(request.signal.reason),
                { once: true },
              );
            },
          }),
        );
      });
      vi.stubGlobal("fetch", upstream);
      const gate = new GeocodeGate(memoryStorage());
      const statuses: number[] = [];
      const first = ask(gate, "横浜駅").then((response) => statuses.push(response.status));
      await vi.advanceTimersByTimeAsync(100);
      const second = ask(gate, "横浜駅").then((response) => statuses.push(response.status));
      await vi.advanceTimersByTimeAsync(9899);
      expect(statuses).toEqual([]);
      expect(upstream).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(statuses).toEqual([504, 504]);
      expect(signal?.aborted).toBe(true);
      await Promise.all([first, second]);
      const again = ask(gate, "横浜駅");
      await vi.advanceTimersByTimeAsync(0);
      expect((await again).status).toBe(200);
      expect(upstream).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("同じ瞬間に来た問い合わせを、送る時刻で 1.1 秒ずつ空ける", async () => {
    /*
     * **待ち時間を返すのではなく、ここから送る。** 呼び出し元に待たせて送らせると、
     * 拠点ごとの遅れの差で間隔が 1 秒を割る。見るのは Nominatim に届いた時刻。
     */
    const sentAt = stubNominatim();
    const gate = new GeocodeGate(memoryStorage());
    const replies = ["横浜駅", "新宿駅", "渋谷駅", "池袋駅"].map((q) => ask(gate, q));
    await vi.runAllTimersAsync();
    const statuses = await Promise.all(replies.map(async (r) => (await r).status));

    expect(sentAt).toEqual([0, GEOCODE_SPACING_MS, GEOCODE_SPACING_MS * 2]);
    // 4 本目は待たせすぎになるので、送らずに断る。
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("追い出されて作り直されても、予約済みの枠を忘れない", async () => {
    // メモリに持っていたときは、作り直した直後の 1 本が同じ瞬間に送られていた。
    const sentAt = stubNominatim();
    const state = memoryStorage();
    const first = ask(new GeocodeGate(state), "横浜駅");
    // 作り直しは、前の実体が枠を書き終えて消えたあとに起きる。
    await vi.advanceTimersByTimeAsync(0);
    const second = ask(new GeocodeGate(state), "新宿駅");
    await vi.runAllTimersAsync();
    await Promise.all([first, second]);
    expect(sentAt).toEqual([0, GEOCODE_SPACING_MS]);
  });

  it("同じ地名が同時に来たら、Nominatim へは 1 本だけ送る", async () => {
    const sentAt = stubNominatim();
    const gate = new GeocodeGate(memoryStorage());
    const replies = [ask(gate, "横浜駅"), ask(gate, "横浜駅")];
    await vi.runAllTimersAsync();
    const bodies = await Promise.all(replies.map(async (r) => (await r).text()));
    expect(sentAt).toHaveLength(1);
    expect(bodies).toEqual(["[]", "[]"]);
  });

  it("失敗した問い合わせはまとめない。次は送り直す", async () => {
    const sentAt = stubNominatim(503);
    const gate = new GeocodeGate(memoryStorage());
    const first = ask(gate, "横浜駅");
    await vi.runAllTimersAsync();
    expect((await first).status).toBe(503);

    const again = ask(gate, "横浜駅");
    await vi.runAllTimersAsync();
    await again;
    expect(sentAt).toHaveLength(2);
  });

  it("送信そのものが落ちても、控えに残さず次は送り直す", async () => {
    // 落ちた Promise が控えに残ると、60 秒の間、同じ地名はずっと同じ失敗を返していた。
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("network down");
        return Response.json([]);
      }),
    );
    const gate = new GeocodeGate(memoryStorage());
    const first = ask(gate, "横浜駅");
    await vi.runAllTimersAsync();
    expect((await first).status).toBe(502);

    const again = ask(gate, "横浜駅");
    await vi.runAllTimersAsync();
    expect((await again).status).toBe(200);
    expect(calls).toBe(2);
  });

  it("本文の読み込みで落ちても、控えに残さず次は送り直す", async () => {
    // 応答の頭は届いたのに、本文の途中で切れる。送信の失敗とは別の経路で残っていた。
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls > 1) return Response.json([]);
        const broken = new ReadableStream({
          start: (controller) => controller.error(new Error("connection reset")),
        });
        return new Response(broken, { status: 200 });
      }),
    );
    const gate = new GeocodeGate(memoryStorage());
    const first = ask(gate, "横浜駅");
    await vi.runAllTimersAsync();
    expect((await first).status).toBe(502);

    const again = ask(gate, "横浜駅");
    await vi.runAllTimersAsync();
    expect((await again).status).toBe(200);
    expect(calls).toBe(2);
  });

  it("保存領域への書き込みで落ちても、控えに残さず次は送り直す", async () => {
    stubNominatim();
    let puts = 0;
    const store = new Map<string, unknown>();
    const gate = new GeocodeGate({
      storage: {
        get: async (k: string) => store.get(k),
        put: async (k: string, v: unknown) => {
          puts += 1;
          if (puts === 1) throw new Error("storage unavailable");
          store.set(k, v);
        },
      } as never,
    });
    // 待つ前に受け止めておく。後から await すると、その間は処理されない拒否になる。
    const first = expect(ask(gate, "横浜駅")).rejects.toThrow("storage unavailable");
    await vi.runAllTimersAsync();
    await first;

    const again = ask(gate, "横浜駅");
    await vi.runAllTimersAsync();
    expect((await again).status).toBe(200);
  });

  it("まとめる時間は、答えが返ってから数える", async () => {
    /*
     * KV に書いた結果が他の拠点から読めるまで 60 秒ほどかかる。受け付けた時点から
     * 数えると、列で待った分だけ短くなり、読めるようになる前に送り直していた。
     */
    const sentAt = stubNominatim();
    const gate = new GeocodeGate(memoryStorage());
    // 先に 2 本並べ、見たい問い合わせを 2.2 秒待たせる。
    const queued = [ask(gate, "新宿駅"), ask(gate, "渋谷駅"), ask(gate, "横浜駅")];
    await vi.runAllTimersAsync();
    await Promise.all(queued);
    expect(sentAt).toHaveLength(3);

    // 答えが返ってから 69 秒。受け付けから数えると 71.2 秒で、控えの期限を過ぎている。
    await vi.advanceTimersByTimeAsync(69_000);
    await ask(gate, "横浜駅");
    expect(sentAt).toHaveLength(3);
  });
});

describe("GeocodeGate（本物の時計）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("処理が詰まって待ちが過ぎても、送る間隔を詰めない", async () => {
    /*
     * 止めた時計では、タイマーが予定どおりの時刻に 1 本ずつ起きてしまい再現できない。
     * 本物の時計で 2.5 秒ふさぎ、待っていたタイマーをまとめて起こす。
     * 直す前は 2 本目と 3 本目が 1 ms 差で送られていた。
     */
    const t0 = Date.now();
    const sentAt: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (sentAt.push(Date.now() - t0), Response.json([]))),
    );
    const gate = new GeocodeGate(memoryStorage());
    const replies = ["横浜駅", "新宿駅", "渋谷駅"].map((q) =>
      gate.fetch(
        new Request(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}`),
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));
    const until = Date.now() + 2500;
    while (Date.now() < until) {
      // 処理が詰まった状態を作る
    }
    await Promise.all(replies);

    expect(sentAt).toHaveLength(3);
    for (let i = 1; i < sentAt.length; i++) {
      expect(sentAt[i] - sentAt[i - 1]).toBeGreaterThanOrEqual(GEOCODE_SPACING_MS);
    }
  }, 10_000);

  it("遅れて送った直後に作り直されても、送った時刻から間隔を空ける", async () => {
    /*
     * 2 本目を 1100 ms に予約したまま処理を 3 秒ふさぎ、予約より遅れて送らせる。
     * 保存してある次の枠（2200 ms）はもう過ぎているので、実際に送った時刻を
     * メモリにだけ持っていると、作り直した実体がすぐに 3 本目を送っていた。
     */
    const t0 = Date.now();
    const sentAt: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (sentAt.push(Date.now() - t0), Response.json([]))),
    );
    const state = memoryStorage();
    const before = new GeocodeGate(state);
    const queued = ["a", "b"].map((q) =>
      before.fetch(new Request(`https://nominatim.openstreetmap.org/search?q=${q}`)),
    );
    await new Promise((resolve) => setImmediate(resolve));
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      // 2 本目を予約より遅らせる
    }
    await Promise.all(queued);
    // 2 本目を送った直後に作り直された実体が、3 本目を受ける。
    await new GeocodeGate(state).fetch(
      new Request("https://nominatim.openstreetmap.org/search?q=c"),
    );

    expect(sentAt).toHaveLength(3);
    expect(sentAt[2] - sentAt[1]).toBeGreaterThanOrEqual(GEOCODE_SPACING_MS);
  }, 10_000);
});
