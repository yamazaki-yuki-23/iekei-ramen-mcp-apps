import type { Shop } from "../../../types";

export const mapUrl = (s: Shop) =>
  `https://www.google.com/maps/search/?api=1&query=${s.lat}%2C${s.lon}`;
