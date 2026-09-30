/**
 * Overpass への問い合わせ。
 *
 * **ここで静かに失敗すると、県が丸ごと消える。** データは gitignore の
 * osm-raw.json 1 本しか無く、欠けたまま上書きすると取り直すしかない。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error データ生成スクリプトと共有する素の JS モジュール
import { DECLARES, fetchPref, query, toElement } from "../scripts/overpass-query.mjs";

/** 呼ばれた順に応答を返す fetch。何回・どこへ投げたかを残す。 */
function stubFetch(
  responses: Array<{
    ok?: boolean;
    status?: number;
    elements?: unknown[];
    throws?: string;
    badBody?: string;
  }>,
) {
  const calls: string[] = [];
  let i = 0;
  vi.stubGlobal("fetch", (url: string) => {
    calls.push(url);
    const r = responses[Math.min(i++, responses.length - 1)];
    // 応答が返らないとき。fetch は状態コードではなく例外で失敗する。
    if (r.throws) return Promise.reject(new Error(r.throws));
    return Promise.resolve({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      statusText: "",
      // 本文が途中で切れた応答。状態コードは 200 のまま、読み出しで失敗する。
      json: () =>
        r.badBody
          ? Promise.reject(new Error(r.badBody))
          : Promise.resolve({ elements: r.elements ?? [] }),
    });
  });
  return calls;
}

/**
 * 待ち時間を実時間で待たない。
 *
 * 諦めるまでに 5 + 10 + 15 + 20 秒待つ作りなので、素直に回すとテストが
 * タイムアウトする。**待ちを飛ばすだけで、回数と順番はそのまま測る。**
 */
function runPending() {
  return vi.runAllTimersAsync();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("query — 拾う条件", () => {
  it("店名だけでなく、現地で入力された説明の欄も見る", () => {
    // これが無いと、名前に「家」を持たない家系が落ちる（壱角屋・春樹・大和家）。
    const q = query("東京都");
    for (const tag of [
      "cuisine:ja",
      "description",
      "description:ja",
      "loc_name",
      "official_name",
    ]) {
      expect(q, `${tag} を見ていない`).toContain(`nwr["${tag}"~"${DECLARES}"]`);
    }
  });

  it("判定が名乗りと見なす綴りを、取得も拾う", () => {
    /*
     * **判定と取得で綴りを揃える。** 判定は「横浜ラーメン」を名乗りと見なすのに、
     * 取得が「家系」の 3 文字だけを探していると、`description` にそう書いた
     * だけの店はそもそも判定まで届かない。
     *
     * 並べたのは judgments.mjs の name_declares_iekei が例に挙げている綴り。
     */
    const declares = new RegExp(DECLARES);
    for (const written of [
      "横浜家系ラーメン",
      "横濱家系",
      "資本系家系ラーメン",
      "横浜ラーメン",
      "横濱ラーメン",
      "横浜らーめん",
    ]) {
      expect(declares.test(written), `「${written}」を拾わない`).toBe(true);
    }
  });

  it("屋号の「〜家」や地名だけでは、名乗りとして拾わない", () => {
    // 判定が名乗りではないと明記しているもの。拾うと母集団が膨らむだけになる。
    const declares = new RegExp(DECLARES);
    for (const written of ["田上家", "横浜荏田町店", "ららぽーと横浜店", "自家製麺"]) {
      expect(declares.test(written), `「${written}」を拾っている`).toBe(false);
    }
  });

  it("誤記の名乗りは、ラーメン店で店名に「家」がある条件から入る", () => {
    /*
     * 判定は「家系」の誤記も名乗りと見なすが、誤記は綴りに並べていない（種類に
     * 限りが無い）。**誤記は「家」の字を残すので、最初の条件が受け持つ。**
     * 実測: 「横浜家糸ラーメン」はここから入り、判定が誤記を読んで確定になった。
     * この条件を狭めると、誤記の店は判定まで届かなくなる。
     */
    expect(query("東京都")).toContain('nwr["cuisine"~"ramen"]["name"~"家"]');
    expect(new RegExp(DECLARES).test("横浜家糸ラーメン"), "誤記を綴りで拾う前提になっている").toBe(
      false,
    );
  });

  it("都道府県を絞り込みに入れる", () => {
    expect(query("東京都")).toContain('["name"="東京都"]');
  });
});

describe("fetchPref — 0 件を疑う", () => {
  it("0 件で返ってきたら、別のエンドポイントへ投げ直す", async () => {
    // Overpass は area を引けなくても HTTP 200 と空の結果を返す。
    // 実測: 茨城県が 0 件で返り、投げ直したら 20 件返った（公開中は 12 店）。
    const calls = stubFetch([{ elements: [] }, { elements: [{ id: 1 }, { id: 2 }] }]);
    const got = fetchPref("茨城県");
    await runPending();
    await expect(got).resolves.toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(calls[0]).not.toBe(calls[1]);
  });

  it("投げ直しても 0 件なら、0 件として受け入れる", async () => {
    // 富山県・高知県は本当に 0 件。失敗にすると取得が終わらない。
    const calls = stubFetch([{ elements: [] }]);
    const got = fetchPref("富山県");
    await runPending();
    await expect(got).resolves.toHaveLength(0);
    expect(calls, "0 件を疑い続けている").toHaveLength(2);
  });

  it("並列の枠番号を渡されても、0 件は同じだけ疑う", async () => {
    // 全国取得は attempt に枠番号（0〜2）を渡す。試行回数と混ぜて数えると、
    // 枠によって疑ったり疑わなかったりする。
    const calls = stubFetch([{ elements: [] }, { elements: [{ id: 1 }] }]);
    const got = fetchPref("茨城県", 2);
    await runPending();
    await expect(got).resolves.toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("応答が返らないときも投げ直す", async () => {
    /*
     * fetch は状態コードではなく例外で失敗する。**状態コードだけを見ていると
     * 再試行に一度も入らない。** 実測: 全国取得で落ちた 9 県のうち 7 県が
     * `fetch failed` で、504 は 2 県だけだった。
     */
    const calls = stubFetch([{ throws: "fetch failed" }, { elements: [{ id: 1 }] }]);
    const got = fetchPref("千葉県");
    await runPending();
    await expect(got).resolves.toHaveLength(1);
    expect(calls, "1 回で諦めている").toHaveLength(2);
  });

  it("応答が返らないまま 5 回落ちたら、理由をつけて投げる", async () => {
    const calls = stubFetch([{ throws: "fetch failed" }]);
    const got = fetchPref("千葉県").catch((error) => error);
    await runPending();
    expect(String(await got)).toContain("千葉県: fetch failed");
    expect(calls).toHaveLength(5);
  });

  it("本文が壊れていても投げ直す", async () => {
    /*
     * Overpass は HTTP 200 のまま、本文が途中で切れた応答を返すことがある
     * （応答ヘッダが届いたあとで接続が切れた場合）。**状態コードは成功なので、
     * 読み出しの失敗を拾わないと、その県だけ予備エンドポイントへ回らない。**
     */
    const calls = stubFetch([
      { badBody: "Unexpected end of JSON input" },
      { elements: [{ id: 1 }] },
    ]);
    const got = fetchPref("神奈川県");
    await runPending();
    await expect(got).resolves.toHaveLength(1);
    expect(calls, "1 回で諦めている").toHaveLength(2);
    expect(calls[0]).not.toBe(calls[1]);
  });

  it("本文が壊れたまま 5 回落ちたら、理由をつけて投げる", async () => {
    const calls = stubFetch([{ badBody: "Unexpected end of JSON input" }]);
    const got = fetchPref("神奈川県").catch((error) => error);
    await runPending();
    expect(String(await got)).toContain("神奈川県: Unexpected end of JSON input");
    expect(calls).toHaveLength(5);
  });

  it("並列の枠番号を渡されても、諦めるまでの回数は同じ", async () => {
    /*
     * 全国取得は attempt に枠番号（0〜2）を渡してくる。**枠番号と試行回数を
     * 同じ数で数えると、枠によって粘る回数が変わる**（枠 2 は 3 回で諦める）。
     * 同じ通信の不調でも、枠の割り当て次第で落ちる県と落ちない県が出る。
     */
    for (const slot of [0, 1, 2]) {
      const calls = stubFetch([{ ok: false, status: 504 }]);
      const got = fetchPref("京都府", slot).catch((error) => error);
      await runPending();
      await got;
      expect(calls, `枠 ${slot} の試行回数`).toHaveLength(5);
      vi.unstubAllGlobals();
    }
  });

  it("5 回落ちたら諦めて投げる", async () => {
    const calls = stubFetch([{ ok: false, status: 504 }]);
    // 先に受け手を付ける。タイマーを進めてから付けると、その間の reject が
    // 誰にも拾われず、テストは通るのに未処理の例外が残る。
    const got = fetchPref("京都府").catch((error) => error);
    await runPending();
    expect(String(await got)).toContain("京都府: 504");
    expect(calls, "諦めるまでの回数").toHaveLength(5);
  });
});

describe("toElement — 保存する形", () => {
  it("way の中心座標を使う", () => {
    expect(
      toElement({ type: "way", id: 7, center: { lat: 35.1, lon: 139.2 }, tags: {} }, "東京都"),
    ).toMatchObject({ osmType: "way", osmId: 7, lat: 35.1, lon: 139.2, prefecture: "東京都" });
  });

  it("座標を持たない要素は捨てる", () => {
    expect(toElement({ type: "relation", id: 9, tags: {} }, "東京都")).toBeNull();
  });
});
