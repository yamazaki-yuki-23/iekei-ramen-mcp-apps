/**
 * 本文を上限のバイト数まで読んで文字にする。**`Content-Length` は信用せず、読みながら数える**
 * （書き換えられるうえ、無いこともある）。上限を超えたら、その場で読むのを止めて null を返す。
 * 本文が無ければ空の文字列。`/reports`（4KiB）と `/mcp`（#429）で使う。
 */
export async function readLimited(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<string | null> {
  if (!body) return "";
  const reader = body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    // ストリームは逐次読む。並列化すると本文の上限を守れない。
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      // 上限を越えた本文はその場で読み取りを止める。
      // eslint-disable-next-line no-await-in-loop
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
