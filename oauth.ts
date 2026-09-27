/**
 * 会員機能のための認証。
 *
 * **匿名の人を止めないことが最優先。** `/mcp` は誰でも叩ける。トークンが付いて
 * いれば誰かが分かり、無ければ匿名として扱う。スタンプの tool だけが、無い人に
 * 401 を返して「サインインしてください」とホストに伝える。
 *
 * 認可サーバーは `@cloudflare/workers-oauth-provider` に任せる。自前で書くと、
 * 認可コードの使い回し・リダイレクト先の検証・トークンの保管を全部自分で
 * 守ることになり、間違えたときの代償がバグではなく事故になる。
 *
 * **ただし `/mcp` はライブラリに通さない。** ライブラリの apiRoute は、トークンの
 * 無いリクエストをハンドラの手前で 401 にするので、匿名が通らなくなる
 * （実装を読んで確認済み: `if (!bearerMatch) return new Response(null, { status: 401 ... })`）。
 * 代わりに `validateToken` を自分で呼ぶ。
 *
 * 人の身元確認は Google に委ねる。**パスワードは受け取らないし保存もしない。**
 */
import type { OAuthAuthorizationServer } from "@cloudflare/workers-oauth-provider";

/**
 * 認可サーバーは**使うときに初めて読み込む**。
 *
 * このライブラリは `cloudflare:workers` を取り込むので、素直に import すると
 * Node で動かしているローカルサーバーが起動できない
 * （`ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'cloudflare:'`）。
 * 匿名のリクエストでは触らないので、遅らせれば手元の開発は今までどおり動く。
 */
async function loadAuthServer(origin: string): Promise<OAuthAuthorizationServer<AuthEnv>> {
  const { OAuthAuthorizationServer: Server } = await import("@cloudflare/workers-oauth-provider");
  return new Server<AuthEnv>({
    issuer: origin,
    resources: [resourceUrl(origin)],
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    scopesSupported: [STAMP_SCOPE],
  });
}

export interface AuthEnv {
  OAUTH_KV: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /**
   * `sub` を記録用の ID に変えるための鍵。
   *
   * **この鍵は二度と変えられない。** 変えると全員の user_id が変わり、記録が
   * 迷子になる。トークンの署名鍵と分けてあるのはそのため（署名鍵は漏れたら
   * 交換できる必要がある）。
   */
  VISITOR_ID_PEPPER: string;
}

/** スタンプに必要な権限。 */
const STAMP_SCOPE = "stamp";

/** サインインした人の呼び名。Google の sub そのものは持たない。 */
export interface Visitor {
  id: string;
}

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

/** この Worker が名乗る資源の URL。トークンはこの資源向けのものだけ受け付ける。 */
const resourceUrl = (origin: string) => `${origin}/mcp`;

/**
 * 401 が指す先（RFC 9728 の資源メタデータ）。
 *
 * **ここは自分で返す。** `OAuthAuthorizationServer` は認可サーバー側の文書しか
 * 出さず（`resourceMetadata` は `OAuthResourceServer` の設定）、任せると 404 に
 * なる。401 が存在しない URL を指していると、ホストはサインインの入口を
 * 見つけられない。
 *
 * 資源に道（`/mcp`）があるときは `/.well-known/oauth-protected-resource/mcp` を
 * 先に見に来るホストがあるので、両方で返す。
 */
export function isResourceMetadataPath(pathname: string): boolean {
  return (
    pathname === "/.well-known/oauth-protected-resource" ||
    pathname === "/.well-known/oauth-protected-resource/mcp"
  );
}

/** 資源メタデータの中身。**KV も鍵も要らない**ので、手元でも同じものを返せる。 */
export function resourceMetadata(origin: string, headers: Record<string, string> = {}): Response {
  return Response.json(
    {
      resource: resourceUrl(origin),
      authorization_servers: [origin],
      scopes_supported: [STAMP_SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "家系ラーメンを探す",
    },
    { headers },
  );
}

/** ライブラリに渡す道（`/authorize` は自分で持つので含めない）。 */
export function isOAuthPath(pathname: string): boolean {
  return (
    pathname === "/token" || pathname === "/register" || pathname.startsWith("/.well-known/oauth-")
  );
}

/**
 * `sub` を記録用の ID にする。
 *
 * **生の sub を保存しない。** 記録が漏れたときに Google アカウントと直結させない
 * ため。機能は変わらず、被害の大きさだけが変わる。
 */
async function visitorId(sub: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(sub));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * いまのリクエストが誰のものか。
 *
 * **無ければ null。例外にしない。** 匿名の人が大半なので、ここは通常の経路。
 */
export async function visitorOf(
  request: Request,
  env: AuthEnv,
  origin: string,
): Promise<Visitor | null> {
  const token = request.headers.get("Authorization")?.match(/^Bearer[\t ]+([^\s,]+)$/i)?.[1];
  /*
   * トークンが無ければ**認可サーバーを読み込みもしない**。大半はこの道を通る。
   * KV が無い環境（Node の手元サーバー）でも読み込まない——`cloudflare:workers`
   * の import が失敗し、**プロセスごと落ちる**ため。トークンを検証する相手が
   * いない以上、どのみち匿名として扱うほかない。
   */
  if (!token || !env.OAUTH_KV) return null;
  const server = await loadAuthServer(origin);
  const validated = await server.validateToken<{ visitorId?: string }>(
    resourceUrl(origin),
    token,
    env,
  );
  const id = validated?.props?.visitorId;
  return typeof id === "string" ? { id } : null;
}

/** サインインが要る tool に、トークン無しで来たときの返事。 */
export function signInChallenge(origin: string, headers: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 401,
    headers: {
      ...headers,
      "WWW-Authenticate":
        `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", ` +
        `scope="${STAMP_SCOPE}"`,
    },
  });
}

/**
 * `/authorize`。ホストから来た認可要求を預けて、Google のサインインへ送る。
 *
 * 同意画面は出さない。**ここで聞けることが無いため**——渡す権限は「スタンプを
 * 付ける」1 つだけで、選択肢の無い画面はクリックを 1 回増やすだけになる。
 */
export async function startSignIn(
  request: Request,
  env: AuthEnv,
  origin: string,
): Promise<Response> {
  const api = (await loadAuthServer(origin)).getOAuthApi(env);
  const headers = new Headers();
  try {
    // 受け付けから Google へ送り出すまでを一続きで囲う。KV の読み書きで
    // つまずいたときも、ホストには理由の分かる返事が届く。
    const authRequest = await api.parseAuthRequest(request);
    const upstream = await api.beginUpstream(authRequest, { headers });

    const to = new URL(GOOGLE_AUTH);
    to.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    to.searchParams.set("redirect_uri", `${origin}/callback/google`);
    to.searchParams.set("response_type", "code");
    // 欲しいのは「同じ人か」だけ。メールも名前も保存しないが、sub を得るのに要る。
    to.searchParams.set("scope", "openid");
    to.searchParams.set("state", upstream.state);
    headers.set("Location", to.toString());
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return authorizeFailure(error);
  }
}

/**
 * `/authorize` を受け付けられなかったとき。
 *
 * **500 にしない。** ホストが前に登録した client_id を持ち越していて、KV から
 * 消えているだけ、ということが起きる（実際、未登録の client_id で 500 になって
 * いた）。理由の分かる返事なら、ホストは登録からやり直せる。
 *
 * 型を import すると `cloudflare:workers` まで一緒に読み込まれるので、
 * `AuthorizationError` かどうかは**形で見る**。知らない失敗は握り潰さずに投げ直す。
 */
export function authorizeFailure(error: unknown): Response {
  const detail = error as {
    code?: unknown;
    description?: unknown;
    redirectUri?: unknown;
    state?: unknown;
  };
  if (typeof detail?.code !== "string") throw error;
  const description = typeof detail.description === "string" ? detail.description : detail.code;

  // 戻り先が分かっているときは、OAuth の作法どおりそちらへ理由を返す。
  // ライブラリは redirect_uri を確かめたあとにだけ、この値を載せてくる。
  if (typeof detail.redirectUri === "string") {
    const back = new URL(detail.redirectUri);
    back.searchParams.set("error", detail.code);
    back.searchParams.set("error_description", description);
    if (typeof detail.state === "string") back.searchParams.set("state", detail.state);
    return new Response(null, { status: 302, headers: { Location: back.toString() } });
  }
  return new Response(`サインインを始められませんでした: ${description}`, { status: 400 });
}

/**
 * 認可を「失敗」として終わらせ、ホストの戻り先へ返す。
 *
 * 戻り先はライブラリが確かめたもの（`parseAuthRequest` を通った要求）だけを使う。
 * 確かめていない URL へ error を付けて飛ばすと、そこが攻撃者の用意した先でも
 * 飛んでしまう。
 */
export function backToClient(
  authRequest: { redirectUri?: string; state?: string },
  headers: Headers,
  code: string,
  description: string,
): Response {
  if (!authRequest.redirectUri) {
    // 戻り先すら分からないときだけ、画面に出して終わる。
    return new Response(`サインインを完了できませんでした: ${description}`, { status: 400 });
  }
  const back = new URL(authRequest.redirectUri);
  back.searchParams.set("error", code);
  back.searchParams.set("error_description", description);
  if (authRequest.state) back.searchParams.set("state", authRequest.state);
  const out = new Headers(headers);
  out.set("Location", back.toString());
  return new Response(null, { status: 302, headers: out });
}

/** Google から戻ってきたところ。`sub` を取り出して、ホストへの認可を完了する。 */
export async function finishSignIn(
  request: Request,
  env: AuthEnv,
  origin: string,
): Promise<Response> {
  const api = (await loadAuthServer(origin)).getOAuthApi(env);
  const resumed = await api.finishUpstream(request);

  /*
   * **ここから先の失敗は、ホストへ返す。**
   *
   * 画面に 400 を出して終わると、ホストから見た認可はいつまでも終わらない
   * （実測: Google でサインインを断ると「認可コードがありません」の 400 が
   * 出るだけで、ホストには何も届かなかった）。OAuth では、戻り先が確かめ済みの
   * ときは error を付けてそこへ戻すのが終わり方。
   */
  const failed = (code: string, description: string) =>
    backToClient(resumed.request, resumed.headers, code, description);

  const params = new URL(request.url).searchParams;
  // ユーザーが断ったとき（access_denied）もここに来る。Google の言い分を素通しする。
  const denied = params.get("error");
  if (denied) return failed(denied, params.get("error_description") ?? denied);
  const code = params.get("code");
  if (!code) return failed("invalid_request", "Google から認可コードが返りませんでした");

  const exchanged = await exchangeForSubject(env, origin, code);
  if ("error" in exchanged) return failed(exchanged.error, exchanged.description);

  try {
    const id = await visitorId(exchanged.sub, env.VISITOR_ID_PEPPER);
    const done = await api.completeAuthorization({
      request: resumed.request,
      userId: id,
      scope: [STAMP_SCOPE],
      metadata: {},
      // props はトークンに紐づく。**ここに入れたものだけ**が tool 側で読める。
      props: { visitorId: id },
    });
    const headers = new Headers(resumed.headers);
    headers.set("Location", done.redirectTo);
    return new Response(null, { status: 302, headers });
  } catch {
    // ここで投げると Worker のエラー画面が出るだけで、ホストの認可は終わらない。
    return failed("server_error", "サインインを完了できませんでした");
  }
}

/**
 * 認可コードを Google に渡して `sub` を得る。
 *
 * **例外を投げない。** DNS や TLS、一時的な切断でも `fetch` は throw するので、
 * 素通しすると Worker のエラー画面が出て、**ホストから見た認可が終わらないまま
 * 残る**（ユーザーには「サインインが進まない」としか見えない）。失敗も値で返し、
 * 呼ぶ側が戻り先へ返せるようにする。
 *
 * `fetchImpl` は試験用。本番では既定の `fetch` を使う。
 */
export async function exchangeForSubject(
  env: Pick<AuthEnv, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET">,
  origin: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sub: string } | { error: string; description: string }> {
  try {
    const token = await fetchImpl(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${origin}/callback/google`,
        grant_type: "authorization_code",
      }),
    });
    if (!token.ok) return { error: "server_error", description: "Google との交換に失敗しました" };

    const { id_token } = (await token.json()) as { id_token?: string };
    const sub = subjectOf(id_token);
    if (!sub) {
      return { error: "server_error", description: "Google から利用者を特定できませんでした" };
    }
    return { sub };
  } catch {
    // 中身は返さない。外向きの理由は、どの失敗でも同じ粒度でよい。
    return { error: "server_error", description: "Google と通信できませんでした" };
  }
}

/**
 * ID トークンから `sub` を取り出す。
 *
 * **署名は確かめない。** このトークンは Google の token エンドポイントから
 * HTTPS で直接受け取ったもので、途中に誰も居ない（OpenID Connect の仕様でも、
 * この経路では署名検証は必須とされていない）。
 */
function subjectOf(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const body = idToken.split(".")[1];
  if (!body) return null;
  try {
    const json = atob(body.replaceAll("-", "+").replaceAll("_", "/"));
    const claims = JSON.parse(json) as { sub?: string };
    return claims.sub ?? null;
  } catch {
    return null;
  }
}

/** OAuth のエンドポイントを認可サーバーに処理させる。 */
export async function handleOAuth(
  request: Request,
  env: AuthEnv,
  ctx: ExecutionContext,
  origin: string,
): Promise<Response> {
  return (await loadAuthServer(origin)).fetch(request, env, ctx);
}
