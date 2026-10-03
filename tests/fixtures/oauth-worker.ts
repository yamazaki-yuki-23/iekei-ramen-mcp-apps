import worker from "../../worker";

// 本番の認可サーバーを使い、Googleとの交換だけを固定する。外部通信は禁止。
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url !== "https://oauth2.googleapis.com/token") throw new Error("外部通信は禁止です");
  return Response.json({ id_token: `x.${btoa(JSON.stringify({ sub: "local-consent-user" }))}.y` });
};

export default worker;
