/** 家系ラーメン店の 1 件分のデータ。OSM のタグから生成する。 */
export interface Shop {
  /** OSM 由来の安定 ID。例: "node/604269583" */
  id: string;
  name: string;
  nameEn?: string;
  /** チェーンのブランド名（判明している場合）。 */
  brand?: string;
  /** 味の傾向。ブランドから判定できたものだけ入り、それ以外は "unknown"。 */
  taste: TasteKey;
  /** 家系だと言い切れる度合い。詳しくは CONFIDENCE を見ること。 */
  confidence: ConfidenceKey;
  prefecture: string;
  city?: string;
  address?: string;
  lat: number;
  lon: number;
  openingHours?: string;
  website?: string;
  phone?: string;
  osmUrl: string;
  /** 「近くを探す」の結果にだけ入る、現在地からの直線距離 (km)。 */
  distanceKm?: number;
}

export const TASTES = {
  rich: { label: "直系・濃厚", description: "豚骨醤油が強い、classic な家系" },
  creamy: { label: "クリーミー", description: "まろやかでとろみのあるスープ" },
  chain: { label: "チェーン・万人向け", description: "食べやすくどこでも入りやすい" },
  unknown: { label: "情報なし", description: "傾向を判定できなかった店舗" },
} as const;

export type TasteKey = keyof typeof TASTES;

/**
 * 家系判定の段階。
 *
 * 「家系ではない」と「家系かどうか分からない」は別物なので分けている。
 * 前者はそもそも一覧に載せず、後者が candidate。店名しか手がかりが無い店は
 * 実際に多く、likely に混ぜると「たぶん家系」と読めてしまう。
 */
export const CONFIDENCE = {
  confirmed: { label: "家系", description: "店名が家系を名乗っている、または既知の家系ブランド" },
  likely: { label: "家系の可能性", description: "店名から家系と推定できる" },
  candidate: {
    label: "家系か未判定",
    description: "ラーメン店で屋号が「〜家」だが、家系かどうかは店名から判断できない",
  },
} as const;

type ConfidenceKey = keyof typeof CONFIDENCE;

export type SearchMode = "form" | "nearby" | "map";

/**
 * 「近くを探す」の基準地点。どこから得た座標かを source で持つ。
 * ホストによって取れる精度が違うので、UI 側で断り書きを出し分けるために必要。
 */
export interface Origin {
  lat: number;
  lon: number;
  label?: string;
  /**
   * precise … ブラウザの位置情報（数十 m）
   * host    … ホストが渡してくる大まかな位置（市区町村レベル）
   * edge    … 接続元 IP からの推定（市区町村レベル、ホストが中継すると外れる）
   * place   … 地名入力をジオコーディングした結果
   */
  source: OriginSource;
}

export type OriginSource = "precise" | "host" | "edge" | "place";

export const ORIGIN_NOTES: Record<OriginSource, string> = {
  precise: "現在地",
  host: "だいたいの位置（市区町村レベル）",
  edge: "接続元からの推定（市区町村レベル）",
  place: "指定した地名",
};

/** UI が tool 結果として受け取る構造化データ。 */
export interface AppPayload {
  mode: SearchMode;
  shops: Shop[];
  /** 件数の総計（shops は上限で切られている場合がある）。 */
  total: number;
  /** 適用された絞り込み条件のサマリ。 */
  query: {
    prefecture?: string;
    taste?: TasteKey;
    keyword?: string;
    origin?: Origin;
  };
  /** 選択可能な都道府県（データに実在するものだけ）。 */
  prefectures: string[];
}
