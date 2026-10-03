export { GeocodeGate } from "../../src/lib/geocode-gate";

const attempts = new Map<string, { calls: number; aborted: boolean }>();

// 実際の Durable Object 内で外部 fetch だけを差し替える。公開 API への通信は禁止。
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== "https://nominatim.openstreetmap.org") throw new Error("外部通信は禁止です");
  const state = attempts.get(request.url) ?? { calls: 0, aborted: false };
  attempts.set(request.url, state);
  state.calls += 1;
  if (state.calls > 1) return Response.json(state);
  request.signal.addEventListener(
    "abort",
    () => {
      state.aborted = true;
    },
    { once: true },
  );
  if (url.searchParams.get("q") === "headers") {
    return new Promise<Response>((_, reject) => {
      request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
    });
  }
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("["));
        request.signal.addEventListener("abort", () => controller.error(request.signal.reason), {
          once: true,
        });
      },
    }),
  );
};

export default {
  fetch(request: Request, env: { GEOCODE_GATE: DurableObjectNamespace }) {
    const phase = new URL(request.url).pathname.slice(1);
    return env.GEOCODE_GATE.getByName(phase).fetch(
      new Request(`https://nominatim.openstreetmap.org/search?q=${phase}`),
    );
  },
};
