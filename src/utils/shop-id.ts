/** 掲載の店の ID。OSM の要素・手で足した店・公式の情報で確かめた店。 */
export const SHOP_ID = /^(?:node|way|relation)\/\d+$|^(?:manual|verified)\/[0-9a-f]{20}$/;

/** URL に入れる形（店のページ・共有の URL）。最初の「/」を「-」にする。 */
export const shopSlug = (id: string): string => id.replace("/", "-");

/** URL の形から ID へ。掲載の店の ID の形でなければ undefined（任意の文字列を通さない）。 */
export function shopIdFromSlug(slug: string): string | undefined {
  const id = slug.replace("-", "/");
  return SHOP_ID.test(id) ? id : undefined;
}
