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

  it("絞った一覧の外を選んでも、その 1 軒は載る", () => {
    /*
     * 塊を押して一覧を絞っているとき、その塊の外のマーカーを押すと、
     * 絞った一覧には居ない。入れ場所が無いと、選んだのに詳細も
     * 「まわる店に追加」も消える。
     */
    const focused = [shop("a"), shop("b")];
    const list = mapListShops(focused, "s25", ALL);

    expect(list.map((s) => s.id)).toEqual(["s25", "a", "b"]);
  });

  it("どこにも居ない ID なら一覧はそのまま", () => {
    expect(mapListShops([shop("a")], "missing", ALL).map((s) => s.id)).toEqual(["a"]);
  });
});
