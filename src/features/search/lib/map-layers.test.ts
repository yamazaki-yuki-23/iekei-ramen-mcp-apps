import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * 地図の使い回し（#397）。MapLibre と DOM は偽物にする。確かめたいのは「層ができた知らせが、
 * いまの持ち主に届くか」だけで、描画そのものではない。
 */
const listeners = new Map<string, () => void>();
// どの名前を引いても、呼んでも、同じものを返す（地図の層を足す処理を素通りさせる）。
const anything: unknown = new Proxy(function () {}, {
  get: (_target, key) => (key === "then" ? undefined : anything),
  apply: () => anything,
});
vi.mock("maplibre-gl", () => ({
  addProtocol: () => {},
  setWorkerUrl: () => {},
  // new で呼ばれる。返したものが地図になる（once だけ本物、ほかは素通り）。
  Map: vi.fn(function fakeMap() {
    const self = { once: (event: string, callback: () => void) => listeners.set(event, callback) };
    return new Proxy(self, {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : anything),
    });
  }),
  Marker: vi.fn(),
  NavigationControl: vi.fn(),
  Popup: vi.fn(),
}));
vi.mock("pmtiles", () => ({ Protocol: vi.fn() }));
vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?raw", () => ({ default: "" }));

const { keepMap, openMap } = await import("./map-layers");

const host = { appendChild: () => {} } as unknown as HTMLElement;

beforeEach(() => {
  listeners.clear();
  vi.stubGlobal("document", {
    // 入れ物の要素も、読み書きされるもの（dataset）以外は素通りさせる。
    createElement: () =>
      new Proxy({ dataset: {} } as Record<string, unknown>, {
        get: (target, key) => (key in target ? target[key as string] : anything),
        set: (target, key, value) => ((target[key as string] = value), true),
      }),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("地図の使い回し（#397）", () => {
  it("層ができる前に預けた地図を使い回すと、層ができた知らせは新しい持ち主に届く", () => {
    const first = vi.fn();
    const second = vi.fn();
    const opened = openMap(host, undefined, "map", first);
    keepMap(opened);

    const reused = openMap(host, undefined, "map", second);
    expect(reused.reused).toBe(true);
    expect(reused.overlays.ready).toBe(false);

    // Worker の確かめも、作ったときに始めた 1 本を新しい持ち主が受け取る（確かめを飛ばさない）。
    expect(reused.worker).toBeInstanceOf(Promise);
    expect(reused.worker).toBe(opened.worker);

    listeners.get("style.load")?.();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(reused.overlays.ready).toBe(true);
    keepMap(reused);
  });

  it("層ができた後に預けた地図は、使い回した時点でできていると分かる", () => {
    const opened = openMap(host, undefined, "map", () => {});
    listeners.get("style.load")?.();
    keepMap(opened);
    const later = vi.fn();
    const reused = openMap(host, undefined, "map", later);
    expect(reused.overlays.ready).toBe(true);
    expect(later).not.toHaveBeenCalled();
  });
});
