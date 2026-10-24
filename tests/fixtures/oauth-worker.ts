import worker from "../../server/worker";

// 本番の認可サーバーを使い、Googleとの交換だけを固定する。外部通信は禁止。
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url !== "https://oauth2.googleapis.com/token") throw new Error("外部通信は禁止です");
  const request = new Request(input, init);
  const body = await request.formData();
  if (
    request.method !== "POST" ||
    body.get("grant_type") !== "authorization_code" ||
    body.get("code") !== "local-code" ||
    body.get("client_id") !== "test-client" ||
    body.get("client_secret") !== "test-secret" ||
    body.get("redirect_uri") !== "http://localhost/callback/google"
  ) {
    throw new Error("Googleへの交換リクエストが想定と異なります");
  }
  return Response.json({ id_token: `x.${btoa(JSON.stringify({ sub: "local-consent-user" }))}.y` });
};

// 連打止めは接続元で決める偽物。"blocked" は上限を超えた扱い、"broken" は数えられない扱い。
const REGISTER_LIMITER = {
  limit: async ({ key }: { key: string }) => {
    if (key === "broken") throw new Error("limiter unavailable");
    return { success: key !== "blocked" };
  },
};

export default {
  fetch: (request: Request, env: object, ctx: ExecutionContext) =>
    worker.fetch(request, { ...env, REGISTER_LIMITER } as Parameters<typeof worker.fetch>[1], ctx),
};
