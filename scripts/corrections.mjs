import { createHash } from "node:crypto";
import { ALL_PREFECTURES } from "../src/lib/prefectures.ts";

const text = (value) => typeof value === "string" && value.trim().length > 0;
const locationKey = (shop) => `${shop.name.trim()}@${shop.lat.toFixed(4)},${shop.lon.toFixed(4)}`;

/** 個別の確認結果だけを、OSMの再取得・判定・重複除去の後に重ねる。 */
export function applyCorrections(shops, corrections) {
  if (!Array.isArray(corrections)) throw new Error("corrections.json は配列にしてください");
  for (const [i, correction] of corrections.entries()) {
    const fail = (field) => {
      throw new Error(`corrections.json[${i}]: ${field} が不正です`);
    };
    if (!correction || typeof correction !== "object") fail("補正");
    for (const field of ["reason", "source", "date"]) if (!text(correction[field])) fail(field);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(correction.date) ||
      !Number.isFinite(Date.parse(correction.date)) ||
      new Date(correction.date).toISOString().slice(0, 10) !== correction.date
    )
      fail("date");
    if (["exclude", "closed"].includes(correction.action)) {
      if (!/^(?:(node|way|relation)\/\d+|manual\/[0-9a-f]{20})$/.test(correction.id)) fail("id");
    } else if (correction.action === "add") {
      for (const field of ["name", "prefecture"]) if (!text(correction[field])) fail(field);
      if (!ALL_PREFECTURES.includes(correction.prefecture.trim())) fail("prefecture");
      if (!Number.isFinite(correction.lat) || Math.abs(correction.lat) > 90) fail("lat");
      if (!Number.isFinite(correction.lon) || Math.abs(correction.lon) > 180) fail("lon");
      for (const field of ["city", "address"]) {
        if (correction[field] !== undefined && !text(correction[field])) fail(field);
      }
    } else fail("action");
  }
  let result = shops.slice();
  const aliases = new Map();
  // 履歴を消さずに追記できるよう、ファイルの順に適用する。
  for (const c of corrections) {
    if (c.action !== "add") {
      const target = aliases.get(c.id) ?? c.id;
      result = result.filter((shop) => shop.id !== c.id && shop.id !== target);
      continue;
    }
    const key = locationKey(c);
    const id = `manual/${createHash("sha256").update(key).digest("hex").slice(0, 20)}`;
    const existing = result.find((shop) => locationKey(shop) === key);
    // OSMに入った後でも、以前の手動IDへの閉店・除外を同じ店に効かせる。
    aliases.set(id, existing?.id ?? id);
    // 後のOSM取得で同じ店が載った場合はOSMのIDを維持する。
    if (existing) continue;
    result.push({
      id,
      name: c.name.trim(),
      prefecture: c.prefecture.trim(),
      lat: c.lat,
      lon: c.lon,
      ...(c.city ? { city: c.city.trim() } : {}),
      ...(c.address ? { address: c.address.trim() } : {}),
      confidence: "confirmed",
      taste: "unknown",
      osmUrl: `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=18/${c.lat}/${c.lon}`,
    });
  }
  return result;
}
