import { GeocodeGate } from "../../src/lib/geocode-gate";

// この使い捨てWorkerから外部ネットワークへは出さない。
globalThis.fetch = async (input) => {
  const request = new Request(input);
  if (new URL(request.url).origin !== "https://nominatim.openstreetmap.org") {
    throw new Error("External network is disabled in the GeocodeGate fixture");
  }
  return Response.json({ sentAt: Date.now() });
};

export class DelayedGate {
  readonly #storage: DurableObjectStorage;
  #puts = 0;
  readonly #writes: Array<{ started: number; committed: number; nextFree: unknown }> = [];

  constructor(state: DurableObjectState) {
    this.#storage = state.storage;
  }

  async fetch(request: Request) {
    const state = {
      storage: {
        get: <T>(key: string) => this.#storage.get<T>(key),
        put: async (key: string, value: unknown) => {
          const started = Date.now();
          if (++this.#puts === 2) await new Promise((resolve) => setTimeout(resolve, 250));
          await this.#storage.put(key, value);
          this.#writes.push({ started, committed: Date.now(), nextFree: value });
        },
      } as never,
    };
    // 実際のSQLite保存領域を保ったまま、Gateのメモリだけを毎回作り直す。
    const response = await new GeocodeGate(state).fetch(request);
    const body = (await response.json()) as { sentAt: number };
    return Response.json({ ...body, writes: this.#writes }, { status: response.status });
  }
}

export default {
  fetch(request: Request, env: { GATE: DurableObjectNamespace }) {
    const url = new URL(request.url);
    return env.GATE.getByName("storage-delay").fetch(
      new Request(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(url.pathname)}`,
      ),
    );
  },
};
