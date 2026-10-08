import { describe, expect, it } from "vitest";
import {
  describeBasis,
  describeScope,
  pickRange,
  shortlist,
  SHORTLIST_SIZE,
} from "../src/lib/shortlist";
import type { Origin, Shop } from "../src/lib/types";

/** テスト用の店。指定しない項目は「情報が無い」側に倒す。 */
function shop(id: string, over: Partial<Shop> = {}): Shop {
  return {
    id,
    name: id,
    taste: "unknown",
    confidence: "confirmed",
    prefecture: "神奈川県",
    lat: 35.4657,
    lon: 139.622,
    osmUrl: `https://www.openstreetmap.org/${id}`,
    ...over,
  };
}

/** 横浜駅あたり。 */
const ORIGIN: Origin = { lat: 35.4657, lon: 139.622, label: "横浜駅", source: "place" };

/** 指定した km だけ北へずらした店。距離の順番を作るために使う。 */
function atKmNorth(id: string, km: number, over: Partial<Shop> = {}): Shop {
  return shop(id, { lat: ORIGIN.lat + km / 111, ...over });
}

describe("shortlist", () => {
  it("3 軒だけ返す", () => {
    const list = shortlist([shop("a"), shop("b"), shop("c"), shop("d"), shop("e")]);
    expect(list.picks).toHaveLength(SHORTLIST_SIZE);
    expect(list.poolTotal).toBe(5);
    expect(list.rounds).toBe(2);
  });

  it("基準地点があれば近い順に並べる", () => {
    const list = shortlist([atKmNorth("far", 9), atKmNorth("near", 1), atKmNorth("mid", 5)], {
      origin: ORIGIN,
    });
    expect(list.picks.map((s) => s.id)).toEqual(["near", "mid", "far"]);
    expect(list.basis).toBe("distance");
    // 距離を計算して詰め直しているので、UI とモデルの両方で使える
    expect(list.picks[0].distanceKm).toBeLessThan(list.picks[2].distanceKm!);
  });

  it("基準地点が無ければ営業時間が分かる店を先に出す", () => {
    const list = shortlist([
      shop("noHours1"),
      shop("hasHours", { openingHours: "11:00-23:00" }),
      shop("noHours2"),
    ]);
    expect(list.picks[0].id).toBe("hasHours");
    expect(list.basis).toBe("hours");
  });

  it("近さは判定の段階より優先する（30km 先の確実な店より 300m 先）", () => {
    const list = shortlist(
      [
        atKmNorth("confirmedFar", 30, { confidence: "confirmed" }),
        atKmNorth("likelyNear", 0.3, { confidence: "likely" }),
      ],
      { origin: ORIGIN },
    );
    expect(list.picks[0].id).toBe("likelyNear");
  });

  it("同じ条件なら判定の確かな方を先に出す", () => {
    const list = shortlist([
      shop("likely", { confidence: "likely" }),
      shop("confirmed", { confidence: "confirmed" }),
    ]);
    expect(list.picks.map((s) => s.id)).toEqual(["confirmed", "likely"]);
  });

  it("「家系か未判定」は 3 軒に足りているうちは出さない", () => {
    const list = shortlist([
      shop("a"),
      shop("b"),
      shop("c"),
      shop("unknown1", { confidence: "candidate" }),
    ]);
    expect(list.picks.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(list.poolTotal).toBe(3);
    expect(list.widened).toBe(false);
  });

  it("3 軒に足りないときだけ「家系か未判定」まで広げる", () => {
    const list = shortlist([shop("a"), shop("x", { confidence: "candidate" })]);
    expect(list.picks).toHaveLength(2);
    expect(list.widened).toBe(true);
  });

  it("広げる相手がいなければ、広げたと言わない", () => {
    /*
     * 確実な 1 軒しか無い県（和歌山県・愛媛県・沖縄県・長崎県が実データで該当）。
     * 3 軒に届かないので広げようとするが、足せる「家系か未判定」が 1 軒も無い。
     * 軒数だけで判定すると、何も足していないのに UI とモデルの両方へ
     * 「「家系か未判定」も含めて」という嘘の但し書きが出る。
     */
    const list = shortlist([shop("only")]);
    expect(list.picks.map((s) => s.id)).toEqual(["only"]);
    expect(list.widened).toBe(false);
    expect(describeScope(list)).toContain("家系と分かっている店にしぼって");
  });

  it("round を増やすと次の 3 軒になる", () => {
    const shops = ["a", "b", "c", "d", "e", "f"].map((id) => shop(id));
    expect(shortlist(shops, { round: 0 }).picks.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(shortlist(shops, { round: 1 }).picks.map((s) => s.id)).toEqual(["d", "e", "f"]);
  });

  it("末尾まで行ったら先頭へ戻る（押せなくならない）", () => {
    const shops = ["a", "b", "c", "d"].map((id) => shop(id));
    const wrapped = shortlist(shops, { round: 2 });
    expect(wrapped.round).toBe(0);
    expect(wrapped.picks.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("負の round でも壊れない", () => {
    const shops = ["a", "b", "c", "d"].map((id) => shop(id));
    expect(shortlist(shops, { round: -1 }).round).toBe(1);
  });

  it("候補が 0 件でも壊れない", () => {
    const list = shortlist([]);
    expect(list.picks).toEqual([]);
    expect(list.round).toBe(0);
    expect(list.rounds).toBe(1);
  });

  it("同じ入力なら毎回同じ並びになる（乱数を使っていない）", () => {
    const shops = ["b", "a", "c", "d", "e"].map((id) => shop(id));
    const once = shortlist(shops).picks.map((s) => s.id);
    const twice = shortlist(shops).picks.map((s) => s.id);
    expect(once).toEqual(twice);
  });
});

describe("describeScope と describeBasis", () => {
  it("母集団の内訳がない旧結果を全件 confirmed と断定しない", () => {
    const { includesLikely: _includesLikely, ...legacy } = shortlist([shop("a")]);
    expect(describeScope(legacy)).toContain("家系の可能性");
    expect(describeScope(legacy)).not.toContain("家系と分かっている");
  });

  it("likely の 1 軒を確定扱いせず、可能性を含む母集団と伝える", () => {
    const list = shortlist([shop("likely", { confidence: "likely" })]);
    const text = describeScope(list);
    expect(text).toContain("家系の可能性");
    expect(text).not.toContain("家系と分かっている");
  });

  it("今回の 3 軒が confirmed だけでも母集団の likely を説明する", () => {
    const list = shortlist([
      shop("a"),
      shop("b"),
      shop("c"),
      shop("likely", { confidence: "likely" }),
    ]);
    expect(list.picks.every((s) => s.confidence === "confirmed")).toBe(true);
    expect(describeScope(list)).toContain("家系の可能性");
  });

  it("基準地点があれば、その名前と近い順であることを書く", () => {
    const list = shortlist([atKmNorth("a", 1), atKmNorth("b", 2), atKmNorth("c", 3)], {
      origin: ORIGIN,
    });
    const text = describeBasis(list, list.picks.length, ORIGIN);
    expect(text).toContain("横浜駅から近い順");
    expect(text).toContain("1〜3 軒目");
    // 画面にも出す文なので、判定の段階は書かない（#144。段階は describeScope でモデルにだけ）。
    expect(text).not.toContain("家系");
  });

  it("広げたときは「家系か未判定」も含めたことを書く", () => {
    const list = shortlist([shop("a"), shop("x", { confidence: "candidate" })]);
    expect(describeScope(list)).toContain("「家系か未判定」も含めて");
  });

  it("広げていないときは、しぼったことを書く", () => {
    const list = shortlist([shop("a"), shop("b"), shop("c")]);
    expect(describeScope(list)).toContain("家系と分かっている店にしぼって");
  });
});

describe("pickRange", () => {
  it("並べた中の何軒目かを言う。最後の組が 1 軒なら範囲にしない", () => {
    expect(pickRange({ round: 0 }, 3)).toBe("1〜3 軒目");
    expect(pickRange({ round: 1 }, 3)).toBe("4〜6 軒目");
    expect(pickRange({ round: 117 }, 1)).toBe("352 軒目");
  });
});
