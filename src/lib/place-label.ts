import { distanceKm } from "./geo";
import type { Origin, Shop } from "./types";

/** ここまで近ければ市区町村で呼ぶ。接続元の推定は市区町村より粗いことがあるので広めに。 */
const CITY_KM = 20;
/** ここまでなら都道府県で呼ぶ。これより遠い（国外など）と、近い店の地名は当てにならない。 */
const PREFECTURE_KM = 80;

/**
 * 推定した座標の、日本語の呼び名（#150）。いちばん近い収録店の市区町村・都道府県を借りる。
 *
 * 接続元の推定（Cloudflare）とホストの位置は city / region がローマ字で来るので、そのまま
 * 出すと「Saitama Saitama から近い順」になる。外部の逆ジオコーディングは呼ばない
 * （利用規約と無料枠。#39）。手元の店の地名は日本語で、どの店にも市区町村がある。
 * 推定であることが分かるよう「付近」を付ける。
 */
export function nearbyPlaceLabel(
  lat: number,
  lon: number,
  shops: ReadonlyArray<Pick<Shop, "lat" | "lon" | "prefecture" | "city">>,
): string {
  let nearest: (typeof shops)[number] | undefined;
  let nearestKm = Infinity;
  for (const shop of shops) {
    const km = distanceKm(lat, lon, shop.lat, shop.lon);
    if (km < nearestKm) {
      nearest = shop;
      nearestKm = km;
    }
  }
  if (!nearest || nearestKm > PREFECTURE_KM) return "現在地付近";
  const place = nearestKm <= CITY_KM && nearest.city ? nearest.city : nearest.prefecture;
  return `${place}付近`;
}

/**
 * 推定の位置（edge・host）だけ、呼び名を日本語に置き換える。端末の位置（precise）と
 * 地名（place）は、利用者が見て分かる名前（「現在地」・入力した地名）なので変えない。
 */
export function localizeOrigin(
  origin: Origin,
  shops: ReadonlyArray<Pick<Shop, "lat" | "lon" | "prefecture" | "city">>,
): Origin {
  if (origin.source !== "edge" && origin.source !== "host") return origin;
  return { ...origin, label: nearbyPlaceLabel(origin.lat, origin.lon, shops) };
}
