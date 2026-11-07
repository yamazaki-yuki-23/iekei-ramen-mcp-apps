import { createHash } from "node:crypto";

/** 確かめた店の記録（data/verified.json）のうち、店の ID を作るのに使う欄。 */
interface RecordKey {
  id?: string;
  prefecture?: string;
  address?: string;
}

/** 記録と、引いた座標（data/verified-geo.json）を結ぶ鍵。住所を直したら別の鍵になり、引き直される。 */
export const geoKey = (record: RecordKey) => `${record.prefecture}${record.address}`;

/**
 * 記録が指す店の ID。今のデータにある店は `id`、足した店は都道府県と住所から作る。
 * データを組み立てるとき（scripts）と、系列の記録を引くとき（server、#368）の両方が使うので 1 か所に置く。
 */
export const recordShopId = (record: RecordKey) =>
  record.id ?? `verified/${createHash("sha256").update(geoKey(record)).digest("hex").slice(0, 20)}`;
