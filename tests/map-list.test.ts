import { describe, expect, it } from "vitest";
import { mapListShops } from "../src/lib/map-list";
import type { Shop } from "../src/lib/types";

function shop(id: string): Shop {
  return {
    id,
    name: id,
    taste: "unknown",
    confidence: "confirmed",
    prefecture: "神奈川県",
    lat: 35.4,
    lon: 139.6,
    osmUrl: `https://www.openstreetmap.org/${id}`,
  };
}

const ALL = Array.from({ length: 30 }, (_, i) => shop(`s${i}`));

describe("mapListShops", () => {
  it("長い一覧は 20 件で切る", () => {
    expect(mapListShops(ALL)).toHaveLength(20);
  });

  it("20 件目より後ろを選んだら先頭に持ってくる", () => {
    // 詳細は選んだカードの直下に出るので、一覧に居ないと置き場所が無い。
    const list = mapListShops(ALL, "s25");
    expect(list[0].id).toBe("s25");
    expect(list).toHaveLength(20);
  });

  it("渡された一覧に居ない ID なら、一覧はそのまま", () => {
    /*
     * 塊を開いたまま外の店を選んだときは、塊の一覧ごと畳む側で面倒を見る。
     * ここで拾ってしまうと「この地点の 3 軒」の下に 4 枚目が入る。
     */
    expect(mapListShops([shop("a"), shop("b")], "s25").map((s) => s.id)).toEqual(["a", "b"]);
  });
});
