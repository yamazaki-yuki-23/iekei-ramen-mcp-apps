import type { Origin } from "../../src/types";
import { toCoordinate } from "../utils/caller-location.ts";

/**
 * stdio 実行時に接続元の位置を引くためのエンドポイント。
 * HTTP で動いていれば request.cf を直接読めるので、そちらでは使わない。
 * 空文字を設定すると問い合わせ自体を行わない（テストはこれで外部通信を止める）。
 */
const LOCATION_ENDPOINT =
  globalThis.process?.env?.IEKEI_LOCATION_ENDPOINT ?? "https://iekeiramen.com/whereami";

/** プロセスが生きている間は使い回す（同じ場所から何度も引く意味がない）。 */
let edgeLocationCache: Origin | null | undefined;

/** 位置照会エンドポイントに問い合わせる。失敗したら null を覚えて以後は諦める。 */
export async function fetchEdgeLocation(): Promise<Origin | undefined> {
  if (!LOCATION_ENDPOINT) return undefined;
  if (edgeLocationCache !== undefined) return edgeLocationCache ?? undefined;
  try {
    const res = await fetch(LOCATION_ENDPOINT, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const cf = (await res.json()) as Record<string, unknown>;
    const lat = toCoordinate(cf.latitude, 90);
    const lon = toCoordinate(cf.longitude, 180);
    edgeLocationCache =
      lat === undefined || lon === undefined
        ? null
        : {
            lat,
            lon,
            label: [cf.city, cf.region].filter((v) => typeof v === "string").join(" ") || undefined,
            source: "edge",
          };
  } catch {
    edgeLocationCache = null;
  }
  return edgeLocationCache ?? undefined;
}
