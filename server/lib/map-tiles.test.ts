import { describe, expect, it } from "vitest";
import { parseRange, serveMapTiles } from "./map-tiles";

/** R2 の代わり。範囲を受け取ったとおりに切って返す。 */
function bucket(bytes: Uint8Array) {
  return {
    async get(
      _key: string,
      opts: { range?: { offset?: number; length?: number; suffix?: number } },
    ) {
      const r = opts.range;
      const offset = r?.suffix !== undefined ? bytes.length - r.suffix : (r?.offset ?? 0);
      const length = r?.suffix ?? r?.length ?? bytes.length - offset;
      return {
        size: bytes.length,
        httpEtag: '"e1"',
        range: r ? { offset, length } : undefined,
        body: new Blob([bytes.slice(offset, offset + length)]).stream(),
        writeHttpMetadata: () => {},
      };
    },
  } as unknown as R2Bucket;
}

describe("地図のデータを範囲で返す（#246）", () => {
  it.each([
    ["bytes=0-9", { offset: 0, length: 10 }],
    // 終わりの無い範囲は全体を流せるので受けない。
    ["bytes=100-", undefined],
    ["bytes=0-", undefined],
    // 上限（8MiB）を超える範囲も受けない。
    [`bytes=0-${8 * 1024 * 1024}`, undefined],
    [`bytes=0-${8 * 1024 * 1024 - 1}`, { offset: 0, length: 8 * 1024 * 1024 }],
    [`bytes=-${8 * 1024 * 1024 + 1}`, undefined],
    ["bytes=-16", { suffix: 16 }],
    ["bytes=9-0", undefined],
    ["items=0-9", undefined],
    [null, undefined],
  ])("%s → %j", (header, expected) => {
    expect(parseRange(header)).toEqual(expected);
  });

  it("範囲を付けると 206 と Content-Range を返し、どの枠からでも読める", async () => {
    const res = await serveMapTiles(
      new Request("https://iekeiramen.com/map/japan.pmtiles", { headers: { Range: "bytes=2-5" } }),
      bucket(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])),
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 2-5/8");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([2, 3, 4, 5]);
  });

  it.each([[null], ["items=0-9"], ["bytes=9-0"], ["bytes=0-"]])(
    "範囲指定が無い・読めない GET（%s）は 416 で断り、全体（約 3.6GB）を流さない",
    async (range) => {
      let got = false;
      const spy = {
        async get() {
          got = true;
          return null;
        },
      } as unknown as R2Bucket;
      const res = await serveMapTiles(
        new Request("https://x/map/japan.pmtiles", range ? { headers: { Range: range } } : {}),
        spy,
      );
      expect(res.status).toBe(416);
      expect(got).toBe(false);
    },
  );

  it("ファイルの終わりより後から始まる範囲は、R2 が断るので 416（500 にしない）", async () => {
    const rejecting = {
      async get() {
        throw new Error("The requested range is not satisfiable (10039)");
      },
    } as unknown as R2Bucket;
    const res = await serveMapTiles(
      new Request("https://x/map/japan.pmtiles", {
        headers: { Range: "bytes=4000000000-4000000001" },
      }),
      rejecting,
    );
    expect(res.status).toBe(416);
  });

  it("範囲の誤り以外の R2 の障害は、416 にせず投げ直す（500 として見える）", async () => {
    const failing = {
      async get() {
        throw new Error("Internal error (10001)");
      },
    } as unknown as R2Bucket;
    await expect(
      serveMapTiles(
        new Request("https://x/map/japan.pmtiles", { headers: { Range: "bytes=0-9" } }),
        failing,
      ),
    ).rejects.toThrow("10001");
  });

  it("If-Match が今のファイルと合わなければ 412（置き替えた後に、古い位置で新しい中身を読ませない）", async () => {
    let onlyIf: Headers | undefined;
    const replaced = {
      async get(_key: string, opts: { onlyIf?: Headers }) {
        onlyIf = opts.onlyIf;
        // R2 は条件が合わないと、中身（body）の無い object を返す。
        return { size: 8, httpEtag: '"new"', writeHttpMetadata: () => {} };
      },
    } as unknown as R2Bucket;
    const res = await serveMapTiles(
      new Request("https://x/map/japan.pmtiles", {
        headers: { Range: "bytes=0-9", "If-Match": '"old"' },
      }),
      replaced,
    );
    expect(onlyIf?.get("If-Match")).toBe('"old"');
    expect(res.status).toBe(412);
  });

  it("キャッシュの確かめ（If-None-Match）は R2 に渡さず、中身（206）を返す（412 にしない）", async () => {
    let onlyIf: Headers | undefined;
    const res = await serveMapTiles(
      new Request("https://x/map/japan.pmtiles", {
        headers: { Range: "bytes=2-5", "If-None-Match": '"e1"' },
      }),
      {
        async get(key: string, opts: { range: R2Range; onlyIf?: Headers }) {
          onlyIf = opts.onlyIf;
          return bucket(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])).get(key, opts);
        },
      } as unknown as R2Bucket,
    );
    expect(onlyIf?.has("If-None-Match")).toBe(false);
    expect(res.status).toBe(206);
  });

  it("HEAD は中身を送らず、大きさだけ返す", async () => {
    const head = {
      async head() {
        return { size: 8, httpEtag: '"e1"', writeHttpMetadata: () => {} };
      },
    } as unknown as R2Bucket;
    const res = await serveMapTiles(
      new Request("https://x/map/japan.pmtiles", { method: "HEAD" }),
      head,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe("8");
    expect(res.body).toBeNull();
  });

  it("R2 をつないでいない環境では 404（店のピンは地図の部品とは別に出る）", async () => {
    const res = await serveMapTiles(new Request("https://x/map/japan.pmtiles"));
    expect(res.status).toBe(404);
  });

  it("事前確認（OPTIONS）に、範囲の見出しを許して答える", async () => {
    const res = await serveMapTiles(
      new Request("https://x/map/japan.pmtiles", { method: "OPTIONS" }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Range");
  });
});
