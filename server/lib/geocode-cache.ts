/**
 * 地名検索の結果の置き場（Cache API、#427）。
 *
 * もとは `OAUTH_KV` に相乗りしていたが、KV の書き込みの枠はアカウントで 1 つ（無料プランは 1 日 1,000 件）で、
 * キャッシュに無い地名を引くたびに書くとサインインの枠を食う。Cache API には書き込みの枠が無い。
 *
 * - 鍵は今のサイトの URL の下に作る（Cache API はそのゾーンの URL で持つ）。外からは開けない道
 * - 拠点（データセンター）ごとに持つので、別の拠点で同じ地名を引くと Nominatim へ出直す。
 *   出直す分も GeocodeGate の列と接続元ごとの連打止めを通る
 * - workers.dev（確認用の環境）では Cache API が効かず、毎回問い合わせる。本番は独自ドメインだけで動く（#41）
 */
const PATH = "/__cache/geocode/";

/** Workers の既定のキャッシュ。Node（テスト・手元のサーバー）には無い。 */
const defaultCache = () => (globalThis as { caches?: { default?: Cache } }).caches?.default;

export function geocodeCacheStore(origin: string, cache = defaultCache()) {
  const url = (key: string) => `${origin}${PATH}${encodeURIComponent(key)}`;
  return {
    async get(key: string): Promise<string | null> {
      const hit = await cache?.match(url(key));
      return hit ? hit.text() : null;
    },
    async put(key: string, value: string, { expirationTtl }: { expirationTtl: number }) {
      await cache?.put(
        url(key),
        new Response(value, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${expirationTtl}`,
          },
        }),
      );
    },
  };
}
