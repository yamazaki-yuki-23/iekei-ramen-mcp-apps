/**
 * 地図のデータ（日本の範囲の PMTiles 1 ファイル、#246）を R2 から返す。
 *
 * 地図の部品（pmtiles）は、ファイルのほしい所だけを範囲指定（Range）で読む。全体（約 3.6GB）は
 * 送らない。会話の中（MCP）はホストが用意した別のドメインの枠から取りに来るので、CORS を付ける。
 * 作り直し方と R2 への置き方は docs/development/map.md。
 */
export const MAP_TILES_PATH = "/map/japan.pmtiles";
const OBJECT_KEY = "japan.pmtiles";
/**
 * 1 回に返す上限。地図の部品は、見出し（16KB）・ディレクトリ・タイルを、必ず始まりと終わりのある
 * 範囲で読む。どれも 1MB 前後までなので、余裕を持って 8MiB。終わりの無い範囲（`bytes=0-`）や
 * 大きすぎる範囲で、全体（約 3.6GB）を流させない。
 */
const MAX_RANGE_BYTES = 8 * 1024 * 1024;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, If-Match",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, ETag",
};

/**
 * `bytes=a-b` と `bytes=-n` を R2 の範囲に直す。終わりの無い範囲（`bytes=a-`）・読めないもの・
 * 上限（8MiB）を超えるものは undefined（呼ぶ側が断る）。
 */
export function parseRange(header: string | null): R2Range | undefined {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || m[2] === "") return undefined;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    return suffix > 0 && suffix <= MAX_RANGE_BYTES ? { suffix } : undefined;
  }
  const offset = Number(m[1]);
  const length = Number(m[2]) - offset + 1;
  return length > 0 && length <= MAX_RANGE_BYTES ? { offset, length } : undefined;
}

/**
 * R2 に渡す条件。**置き替えを見分ける `If-Match`・`If-Unmodified-Since` だけを渡す。** 地図データを同じ
 * 名前で置き替えたあと、古い ETag を持つ地図の部品に新しいファイルの中身を返すと、古いディレクトリの
 * 位置で新しいファイルを読ませてしまう（そのときは 412）。キャッシュの確かめ（`If-None-Match`）は渡さない。
 * 渡すと、合ったときも中身の無い object が返り 412 になって、2 回目以降の訪問で読み出しが失敗する。
 * 確かめは評価せず、いつも中身を返す（ブラウザは新しい中身で置き替えるだけ）。
 */
function preconditions(request: Request): Headers {
  const headers = new Headers();
  for (const name of ["If-Match", "If-Unmodified-Since"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export async function serveMapTiles(request: Request, bucket?: R2Bucket): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method Not Allowed", { status: 405, headers: CORS });
  // R2 をまだつないでいない環境（手元・E2E）。背景の地図が出ないだけで、店のピンは出る。
  if (!bucket) return new Response("Not Found", { status: 404, headers: CORS });
  const meta = (object: R2Object) => {
    const headers = new Headers(CORS);
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Accept-Ranges", "bytes");
    // 作り直したら ETag が変わり、pmtiles は読み直す。
    headers.set("Cache-Control", "public, max-age=86400");
    return headers;
  };
  // HEAD は中身を送らず、大きさだけ返す。
  if (request.method === "HEAD") {
    const object = await bucket.head(OBJECT_KEY);
    if (!object) return new Response(null, { status: 404, headers: CORS });
    const headers = meta(object);
    headers.set("Content-Length", String(object.size));
    return new Response(null, { status: 200, headers });
  }
  /*
   * **範囲指定の無い・終わりの無い・大きすぎる GET は断る。** 地図の部品は必ず始まりと終わりの
   * ある範囲で読む。それ以外（URL を直接開いた、監視が確かめに来た、`bytes=0-`）に、全体
   * （約 3.6GB）を流さない。
   */
  const range = parseRange(request.headers.get("Range"));
  if (!range)
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: { ...CORS, "Accept-Ranges": "bytes" },
    });
  /*
   * 範囲がファイルの終わりより後から始まる（`bytes=4000000000-4000000001` など）と、R2 は読み出しを
   * 例外で断る。受けないと 500 になるので、416 で返す。読む前に大きさを確かめると、読み出しが
   * 毎回 1 回増える。
   */
  let object: R2ObjectBody | R2Object | null;
  try {
    object = await bucket.get(OBJECT_KEY, { range, onlyIf: preconditions(request) });
  } catch (error) {
    // 範囲の誤り（R2 の 10039）だけを 416 にする。ほかの障害は 500 のまま見えるようにする。
    if (!/not satisfiable|InvalidRange|10039/i.test(String(error))) throw error;
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: { ...CORS, "Accept-Ranges": "bytes" },
    });
  }
  if (!object) return new Response("Not Found", { status: 404, headers: CORS });
  // 条件が合わないと、R2 は中身の無い object を返す。
  if (!("body" in object))
    return new Response("Precondition Failed", { status: 412, headers: CORS });
  const headers = meta(object);
  const body = object.body;
  const r = object.range as { offset?: number; length?: number } | undefined;
  const offset = r?.offset ?? 0;
  const length = r?.length ?? object.size - offset;
  headers.set("Content-Length", String(length));
  headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
  return new Response(body, { status: 206, headers });
}
