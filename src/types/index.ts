import type { CONFIDENCE, TASTES } from "../utils/labels";
import type { VisitSummary } from "../utils/progress";

/** 家系ラーメン店の1件分。OSMのタグと確認済みの個別補正から生成する。 */
export interface Shop {
  /** OSM・手動追加・確かめた記録の安定ID。例: "node/604269583", "manual/<hash>", "verified/<hash>" */
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
  /** 同じ店名の店がほかにあるときだけ入る、店名に添える町名か市区町村（#307）。サーバーが住所から付ける。 */
  place?: string;
  lat: number;
  lon: number;
  openingHours?: string;
  website?: string;
  phone?: string;
  /** OSM にある店だけ。系列の公式の一覧から足した店（verified/）には無いことがある。 */
  osmUrl?: string;
  /** 「近くを探す」の結果にだけ入る、現在地からの直線距離 (km)。 */
  distanceKm?: number;
  /** 家系マッチのレア札の理由（#166）。事実だけ。find-nearby に facts を頼んだときだけ入る。 */
  facts?: string[];
}

export type TasteKey = keyof typeof TASTES;

type ConfidenceKey = keyof typeof CONFIDENCE;

/**
 * 画面のモード。
 *
 * `visited` だけはサインインした人のもので、**他と違って検索条件を持たない**
 * （その人の記録がそのまま中身になる）。
 */
export type SearchMode = "form" | "nearby" | "map" | "decide" | "visited";

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

/** 地図に出ている範囲。南西と北東の角で持つ。 */
export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

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
    /** 地図に出ていた範囲で絞ったときだけ入る。 */
    bounds?: Bounds;
  };
  /** 選択可能な都道府県（データに実在するものだけ）。 */
  prefectures: string[];
  /** 店名の券売機に並べるブランドと、判定した結果の軒数（多い順、#144）。 */
  brands?: Array<{ name: string; count: number }>;
  /**
   * サインインしている人の訪問済み店舗 ID。
   *
   * **匿名なら入らない。** 「空の配列」と「サインインしていない」を区別する
   * ためで、UI はこれの有無でスタンプを出すかどうかを決める。
   */
  visited?: string[];
  /** 制覇率。visited と同じく、サインインしているときだけ入る。 */
  progress?: VisitSummary;
  /** 「迷ったら」モードのときだけ入る、3 軒をどう選んだかの内訳。 */
  decide?: DecideInfo;
}

/** 検索・地図のスタンプ応答。一覧を差し替えず、記録の全体だけを反映する。 */
interface VisitSnapshot {
  visited: string[];
  progress: VisitSummary;
}

export type VisitResult = AppPayload | VisitSnapshot;

/**
 * 「迷ったら」で 3 軒を選んだ経緯。
 * なぜこの 3 軒なのかを UI とモデルの両方に見せるために持ち回す。
 */
export interface DecideInfo {
  /** 何巡目か（0 始まり）。 */
  round: number;
  /** 全部で何巡できるか。 */
  rounds: number;
  /** 絞り込んだあとの母数。 */
  poolTotal: number;
  /** 並べ替えの根拠。distance=近い順 / hours=営業時間が分かる店から。 */
  basis: "distance" | "hours";
  /** 「家系か未判定」まで含めないと 3 軒に届かなかった。 */
  widened: boolean;
  /** 今回の表示分だけでなく、母集団に「家系の可能性」が入っている。旧結果では未指定。 */
  includesLikely?: boolean;
  /** 「近くで」を頼まれたが現在地が分からず、0 軒で返した（#147）。 */
  needsOrigin?: boolean;
}

/** 家系マッチで札を払う向き（行きたい・知ってる）。効果音も使う。 */
export type SwipeDir = "want" | "pass";
