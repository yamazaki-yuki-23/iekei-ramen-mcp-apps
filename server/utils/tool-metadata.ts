/** どの tool も同じ UI リソースを描画する。 */
export const RESOURCE_URI = "ui://iekei-ramen/mcp-app.html";

/**
 * UI リソースのメタデータ。
 * - csp: 地図タイルを OSM から読むために必要
 * - permissions.geolocation: 「現在地から探す」で navigator.geolocation を使うため
 */
export const UI_RESOURCE_META = {
  ui: {
    domain: "https://iekeiramen.com",
    csp: {
      connectDomains: ["https://*.openstreetmap.org"],
      resourceDomains: ["https://*.openstreetmap.org", "https://*.tile.openstreetmap.org"],
    },
    permissions: { geolocation: {} },
    prefersBorder: true,
  },
};

/**
 * サインインが要る tool。
 *
 * **worker 側がこの名前を見て 401 を返す。** tool の中からは HTTP の状態を
 * 決められないので、入口で止めるしかない。
 */
export const MEMBER_TOOLS = [
  "stamp-iekei-ramen",
  "show-visited-iekei-ramen",
  "forget-my-iekei-ramen-visits",
] as const;

/** SDKが保持する_metaで認証方式を宣言し、HTTPの認証対象と同じ集合から導く。 */
export function toolMetadata(name: string, withUi = true) {
  const member = (MEMBER_TOOLS as readonly string[]).includes(name);
  const oauth = { type: "oauth2", scopes: ["stamp"] };
  const securitySchemes = member
    ? [oauth]
    : name === "geocode-place"
      ? [{ type: "noauth" }]
      : [{ type: "noauth" }, oauth];
  const modifiesVisits = name === "stamp-iekei-ramen" || name === "forget-my-iekei-ramen-visits";
  return {
    annotations: {
      readOnlyHint: !modifiesVisits,
      // スタンプも visited=false なら既存の印を削除する。
      destructiveHint: modifiesVisits,
      openWorldHint: name === "geocode-place",
      idempotentHint: true,
    },
    _meta: {
      securitySchemes,
      ...(withUi ? { ui: { resourceUri: RESOURCE_URI } } : {}),
    },
  };
}
