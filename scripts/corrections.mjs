import { createHash } from "node:crypto";

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
      if (!/^(node|way|relation)\/\d+$/.test(correction.id)) fail("id");
    } else if (correction.action === "add") {
      for (const field of ["name", "prefecture"]) if (!text(correction[field])) fail(field);
      if (!Number.isFinite(correction.lat) || Math.abs(correction.lat) > 90) fail("lat");
      if (!Number.isFinite(correction.lon) || Math.abs(correction.lon) > 180) fail("lon");
      for (const field of ["city", "address"]) {
        if (correction[field] !== undefined && !text(correction[field])) fail(field);
      }
    } else fail("action");
  }
  const removed = new Set(corrections.filter((c) => c.action !== "add").map((c) => c.id));
  const result = shops.filter((shop) => !removed.has(shop.id));
  const seen = new Set(result.map(locationKey));
  for (const c of corrections.filter((entry) => entry.action === "add")) {
    const key = locationKey(c);
    // 後のOSM取得で同じ店が載った場合はOSMのIDを維持する。
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      id: `manual/${createHash("sha256").update(key).digest("hex").slice(0, 20)}`,
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
