import { readFile } from "node:fs/promises";

/**
 * JSON を読む。**失敗を握り潰さない。**
 *
 * 何でも既定値に倒していたため、貯めた地名（areas.json）が壊れていたり
 * 読めなかったりしたときに、空として扱ってそのまま先へ進んでいた。
 * 逆引きの側では上書き保存で写しを失い、整形の側では**地名が抜けた
 * shops.json を正常終了で書き出していた**。
 *
 * 既定値に倒してよいのは「無くてもよいと呼ぶ側が言い、かつファイルが無い」
 * ときだけ。壊れているものは、無くてよいファイルでも止める。
 */
export async function readJson(url, { optional = false } = {}) {
  let text;
  try {
    text = await readFile(url, "utf8");
  } catch (error) {
    if (optional && error.code === "ENOENT") return {};
    throw new Error(`${url.pathname ?? url} を読めません: ${error.message}`, { cause: error });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    // 壊れたものを空として扱わない。上書きすると取り返しがつかない。
    throw new Error(`${url.pathname ?? url} が壊れています: ${error.message}`, { cause: error });
  }
}
