import type { Origin } from "../../src/types";

/**
 * ホストが tool 呼び出しに添えてくる大まかな現在地。
 *
 * ChatGPT はアプリの iframe に geolocation を許可しないため、UI 側の
 * navigator.geolocation は必ず失敗する。代わりにホストが _meta で
 * 市区町村レベルの座標を渡してくるので、それを基準地点に使う。
 * あくまでヒントなので、欠けていても動くようにしておくこと。
 */
interface HostUserLocation {
  /** ChatGPT は仕様上 number だが実際には文字列で送ってくるので、どちらも受ける。 */
  latitude?: number | string;
  longitude?: number | string;
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
}

/** 数値にも文字列にも入りうる座標を number に揃える。範囲外や解釈不能なら undefined。 */
export function toCoordinate(value: unknown, max: number): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > max) return undefined;
  return n;
}

/**
 * Cloudflare が付けてくる接続元の位置情報。
 *
 * ホストが位置を渡してこない場合（Claude など）の最後の手段。
 * 値は `request.cf` に入り、緯度経度は文字列で来る。
 * ホストがサーバー側から中継していると、その中継元の位置になってしまうので
 * あくまで最後に試す。
 */
export function readEdgeLocation(request: Request | undefined): Origin | undefined {
  const cf = (request as { cf?: Record<string, unknown> } | undefined)?.cf;
  const lat = toCoordinate(cf?.latitude, 90);
  const lon = toCoordinate(cf?.longitude, 180);
  if (lat === undefined || lon === undefined) return undefined;
  return {
    lat,
    lon,
    label: [cf?.city, cf?.region].filter((v) => typeof v === "string").join(" ") || undefined,
    source: "edge",
  };
}

/** `_meta` からホスト由来の現在地を取り出す。無ければ undefined。 */
export function readHostLocation(meta: Record<string, unknown> | undefined): Origin | undefined {
  const raw = meta?.["openai/userLocation"] as HostUserLocation | undefined;
  const lat = toCoordinate(raw?.latitude, 90);
  const lon = toCoordinate(raw?.longitude, 180);
  if (lat === undefined || lon === undefined) return undefined;
  return {
    lat,
    lon,
    label: [raw?.city, raw?.region].filter(Boolean).join(" ") || undefined,
    source: "host",
  };
}
