import worker from "../../worker";

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

export default worker;
