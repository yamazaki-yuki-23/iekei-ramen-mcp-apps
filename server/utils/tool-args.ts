import type { CallToolResult } from "@modelcontextprotocol/server";
import type { Bounds, Origin, OriginSource, Shop, TasteKey } from "../../src/types";
import { distanceKm } from "../../src/utils/geo.ts";

/**
 * 片方だけの座標は受け付けない。
 *
 * 黙って無視すると、呼んだ側は距離で並んだつもりなのに、実際は営業時間の
 * 有無で並んだ別物が返る。モデルが座標を片方だけ出したときに、無関係な店を
 * 「近くの店」として見せてしまう。
 */
export function incompleteCoordinates(lat?: number, lon?: number): CallToolResult | undefined {
  if ((lat === undefined) === (lon === undefined)) return undefined;
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: "緯度と経度は両方そろえて指定してください。片方だけでは位置を決められません。",
      },
    ],
  };
}

/**
 * 表示名の正規化。空白だけなら無いものとして扱う。
 *
 * スキーマは空文字も通す。そのまま持つと「【全国】」（条件から落ちる）や
 * 「基準: 」（空のまま出る）のように、場所の抜けた文言があちこちに出る。
 * 入口で無くしておけば、下流はどれも undefined の枝だけを見ればよくなる。
 */
export function blankToUndefined(text?: string): string | undefined {
  return text?.trim() || undefined;
}

export function filterShops(
  dataset: Shop[],
  opts: {
    prefecture?: string;
    taste?: TasteKey;
    keyword?: string;
    bounds?: Bounds;
  },
): Shop[] {
  const kw = opts.keyword?.trim().toLowerCase();
  const b = opts.bounds;
  return dataset.filter((s) => {
    if (opts.prefecture && s.prefecture !== opts.prefecture) return false;
    if (opts.taste && opts.taste !== "unknown" && s.taste !== opts.taste) return false;
    // 範囲は南西・北東の角で来る。日付変更線はまたがない（国内だけのデータ）。
    if (b && (s.lat < b.south || s.lat > b.north || s.lon < b.west || s.lon > b.east)) return false;
    if (kw) {
      // 確かめた系列名も照合する（#368）。系列のページと同じ店が、系列名のキーワードで出る。
      const hay = [s.name, s.nameEn, s.brand, s.chain, s.city, s.address].join(" ").toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

const lowerNames = (s: Shop) => [s.name, s.nameEn].flatMap((n) => (n ? [n.toLowerCase()] : []));

/**
 * キーワードに合った店の並び（#366）。店名を打つ人はその店に行きたいので、
 * 店名の完全一致 → 店名の部分一致 → 系列・地名などの一致 の順にする。
 * 基準地点があれば、それぞれの中を近い順（直線距離）にする。無ければ元の順のまま。
 */
export function rankByKeyword(shops: Shop[], keyword: string, origin?: Origin): Shop[] {
  const kw = keyword.trim().toLowerCase();
  const tier = (s: Shop) =>
    lowerNames(s).includes(kw) ? 0 : lowerNames(s).some((n) => n.includes(kw)) ? 1 : 2;
  const away = (s: Shop) => (origin ? distanceKm(origin.lat, origin.lon, s.lat, s.lon) : 0);
  return shops.toSorted((a, b) => tier(a) - tier(b) || away(a) - away(b));
}

/** 引数から基準地点を組み立てる。**既定の出どころは tool ごとに違う**ので受け取る。
 * 緯度と経度が揃っていなければ基準地点は無い。 */
export function originFrom(
  args: { lat?: number; lon?: number; label?: string; source?: string },
  fallback: OriginSource,
): Origin | undefined {
  if (args.lat === undefined || args.lon === undefined) return undefined;
  return {
    lat: args.lat,
    lon: args.lon,
    label: blankToUndefined(args.label),
    source: (args.source ?? fallback) as OriginSource,
  };
}
