import { test as base, type Frame } from "@playwright/test";
import { frameLocation } from "./frame-location";

export const test = base.extend<{ frameEvidence: void; noMapData: void }>({
  /*
   * 地図のデータ（PMTiles）と文字は取りに行かない（E2E から外部の地図サービスに問い合わせない）。
   * ピン・塊・順路は GeoJSON なので、背景が無くても描かれる。
   */
  noMapData: [
    async ({ page }, use) => {
      await page.route(/\/map\/(japan\.pmtiles|fonts\/)/, (route) => route.abort());
      await use();
    },
    { auto: true },
  ],
  frameEvidence: [
    async ({ page }, use, testInfo) => {
      const started = performance.now();
      const ids = new Map<Frame, number>();
      const events: Array<Record<string, unknown>> = [];
      const id = (frame: Frame) => {
        if (!ids.has(frame)) ids.set(frame, ids.size + 1);
        return ids.get(frame)!;
      };
      const record = (event: string, frame: Frame) => {
        if (events.length >= 500) return;
        events.push({
          event,
          ms: Math.round(performance.now() - started),
          id: id(frame),
          parent: frame.parentFrame() ? id(frame.parentFrame()!) : null,
          location: frameLocation(frame.url()),
        });
      };
      const attached = (frame: Frame) => record("attached", frame);
      const navigated = (frame: Frame) => record("navigated", frame);
      const detached = (frame: Frame) => record("detached", frame);
      page.frames().forEach((frame) => record("initial", frame));
      page.on("frameattached", attached);
      page.on("framenavigated", navigated);
      page.on("framedetached", detached);
      const crashed = () =>
        events.push({ event: "page-crashed", ms: Math.round(performance.now() - started) });
      page.on("crash", crashed);
      try {
        await use();
      } finally {
        page.off("frameattached", attached);
        page.off("framenavigated", navigated);
        page.off("framedetached", detached);
        page.off("crash", crashed);
        await testInfo.attach("frame-lifecycle", {
          contentType: "application/json",
          body: JSON.stringify({
            retry: testInfo.retry,
            viewport: page.viewportSize(),
            status: testInfo.status,
            events,
            finalFrames: page
              .frames()
              .map((frame) => ({ id: id(frame), location: frameLocation(frame.url()) })),
          }),
        });
      }
    },
    { auto: true },
  ],
});
