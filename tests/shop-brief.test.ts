import { describe, expect, it } from "vitest";
import { askMessageText, describeShop } from "../src/lib/shop-brief";
import type { Shop } from "../src/lib/types";

const YOSHIMURAYA: Shop = {
  id: "node/604269583",
  name: "吉村家",
  taste: "rich",
  confidence: "confirmed",
  prefecture: "神奈川県",
  city: "横浜市西区",
  address: "南幸2-12-6",
  lat: 35.463032,
  lon: 139.615069,
  osmUrl: "https://www.openstreetmap.org/node/604269583",
};

describe("describeShop", () => {
  it("店名と所在地と判定を渡す", () => {
    const text = describeShop(YOSHIMURAYA);
    expect(text).toContain("吉村家");
    expect(text).toContain("神奈川県 横浜市西区 南幸2-12-6");
    expect(text).toContain("家系判定: 家系");
  });

  it("味の傾向には参考値だと但し書きを付ける", () => {
    expect(describeShop(YOSHIMURAYA)).toContain("既知ブランドからの参考値");
  });

  it("味が unknown なら推測を禁じる書き方にする", () => {
    const text = describeShop({ ...YOSHIMURAYA, taste: "unknown" });
    expect(text).toContain("情報なし");
    expect(text).toContain("推測で補わないこと");
    expect(text).not.toContain("参考値");
  });

  it("持っていない項目は行ごと出さない", () => {
    const text = describeShop(YOSHIMURAYA);
    expect(text).not.toContain("営業時間:");
    expect(text).not.toContain("電話:");
    expect(text).not.toContain("ブランド:");
    expect(text).not.toContain("直線距離:");
  });

  it("近くを探した結果なら距離を渡す", () => {
    expect(describeShop({ ...YOSHIMURAYA, distanceKm: 0.35 })).toContain("直線距離: 350m");
  });

  it("データの範囲外を答えないよう釘を刺す", () => {
    expect(describeShop(YOSHIMURAYA)).toContain("このアプリのデータには無い");
  });
});

describe("askMessageText", () => {
  it("詳細が届いているなら短い一文だけ送る", () => {
    const text = askMessageText(YOSHIMURAYA, true);
    expect(text).toContain("吉村家");
    expect(text).toContain("神奈川県横浜市西区");
    // 詳細は model context 側にあるので、ここには載せない
    expect(text).not.toContain("OSM");
    expect(text.split("\n")).toHaveLength(1);
  });

  it("詳細が届いていないなら質問に詳細を同梱する", () => {
    const text = askMessageText(YOSHIMURAYA, false);
    expect(text).toContain("について教えて");
    // 但し書きごと送らないと、モデルが推定を事実として答えてしまう
    expect(text).toContain("既知ブランドからの参考値");
    expect(text).toContain("このアプリのデータには無い");
    expect(text).toContain(describeShop(YOSHIMURAYA));
  });
});
