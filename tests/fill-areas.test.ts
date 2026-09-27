/**
 * 逆引きの「もう一度引くか」の判断。
 *
 * **貯めたものを使い続けない場面がある。** OSM は同じ ID のまま位置を直すことが
 * あり、そのとき古い地名を出し続けると、いまの座標と合わない場所を名乗る。
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isStale, needsFetch, pickArea } from "../scripts/fill-areas.mjs";
import { readJson } from "../scripts/read-json.mjs";

describe("needsFetch", () => {
  it("まだ引いていなければ引く", () => {
    expect(needsFetch(undefined, 35.6, 139.7)).toBe(true);
  });

  it("揃っていて同じ場所なら引かない", () => {
    expect(
      needsFetch({ city: "新宿区", area: "西早稲田二丁目", lat: 35.6, lon: 139.7 }, 35.6, 139.7),
    ).toBe(false);
  });

  it("座標が動いていたら引き直す", () => {
    // 100m ほど動いた場合。町が変わることがある。
    expect(
      needsFetch({ city: "新宿区", area: "西早稲田二丁目", lat: 35.6, lon: 139.7 }, 35.601, 139.7),
    ).toBe(true);
  });

  it("町名が取れなかった項目は引き直す", () => {
    /*
     * 欠けたままを「取得済み」にすると、あとから OSM 側に町名が入っても
     * 二度と拾えない。同じ市に同名の店が 2 つあると、永久に見分けられない。
     */
    expect(needsFetch({ city: "瑞穂町", area: null, lat: 35.6, lon: 139.7 }, 35.6, 139.7)).toBe(
      true,
    );
  });

  it("座標を持たない古い項目は引き直す", () => {
    // 座標を貯め始める前に作った項目。合っているか確かめようがない。
    expect(needsFetch({ city: "新宿区" }, 35.6, 139.7)).toBe(true);
  });
});

describe("pickArea", () => {
  it("市区町村と町名を取り出す", () => {
    const picked = pickArea({ city: "新宿区", neighbourhood: "西早稲田二丁目" }, "東京都");
    expect(picked).toEqual({ city: "新宿区", area: "西早稲田二丁目" });
  });

  it("都道府県名は市区町村として使わない", () => {
    /*
     * 町の住所では city に「東京都」が入ってくることがある。そのまま使うと
     * 画面に「東京都 東京都 駒形富士山」と出る（実測）。同じ応答の town に
     * 正しい値（瑞穂町）が入っているので、そちらを採る。
     */
    const picked = pickArea(
      {
        city: "東京都",
        town: "瑞穂町",
        city_district: "西多摩郡",
        neighbourhood: "駒形富士山",
        quarter: "駒形富士山",
      },
      "東京都",
    );
    expect(picked).toEqual({ city: "瑞穂町", area: "駒形富士山" });
  });

  it("同じ語を 2 つ並べない", () => {
    const picked = pickArea({ city: "町田市", suburb: "町田市" }, "東京都");
    expect(picked).toEqual({ city: "町田市", area: null });
  });
});

describe("isStale", () => {
  it("座標が動いていれば古い", () => {
    expect(isStale({ city: "新宿区", lat: 35.6, lon: 139.7 }, 35.601, 139.7)).toBe(true);
  });

  it("同じ場所なら古くない", () => {
    expect(isStale({ city: "新宿区", lat: 35.6, lon: 139.7 }, 35.6, 139.7)).toBe(false);
  });

  it("座標を持たない項目は、合っているか確かめようがないので古い扱い", () => {
    expect(isStale({ city: "新宿区" }, 35.6, 139.7)).toBe(true);
  });

  it("まだ引いていないものは「古い」ではない", () => {
    /*
     * 失敗したときに捨てるかどうかの判断に使う。まだ無いものを「古い」と
     * 扱うと、消すものが無いのに消そうとすることになる。
     */
    expect(isStale(undefined, 35.6, 139.7)).toBe(false);
  });
});

describe("readJson", () => {
  const dir = new URL(`./tmp-${process.pid}/`, import.meta.url);

  beforeAll(async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(new URL("broken.json", dir), "{ これは JSON ではない");
    await writeFile(new URL("ok.json", dir), '{"a":1}');
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("読めれば中身を返す", async () => {
    await expect(readJson(new URL("ok.json", dir))).resolves.toEqual({ a: 1 });
  });

  it("無くてよいと言われたファイルが無ければ空で始める", async () => {
    await expect(readJson(new URL("none.json", dir), { optional: true })).resolves.toEqual({});
  });

  it("要るファイルが無ければ止まる", async () => {
    // 0 件で正常終了すると、材料が無いことに気付けない。
    await expect(readJson(new URL("none.json", dir))).rejects.toThrow("読めません");
  });

  it("壊れていれば、無くてよいファイルでも止まる", async () => {
    /*
     * **空として扱わない。** 貯めた地名が壊れているときに空から始めると、
     * そのまま上書き保存して 480 件を失う（--limit 5 なら 5 件だけ残る）。
     */
    await expect(readJson(new URL("broken.json", dir), { optional: true })).rejects.toThrow(
      "壊れています",
    );
  });
});
