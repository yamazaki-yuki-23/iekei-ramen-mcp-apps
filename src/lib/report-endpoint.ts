import shops from "../../data/shops.json";
import { receiveReport, REPORT_ACCEPTED, ReportSchema } from "./reports";

interface ReportEnv {
  VISITS?: D1Database;
  REPORT_LIMITER?: RateLimit;
}
const ids = new Set(shops.map((shop) => shop.id));
const reply = (message: string, status: number, headers: HeadersInit = {}) =>
  Response.json({ message }, { status, headers: { "Cache-Control": "no-store", ...headers } });

export async function handleReport(request: Request, env: ReportEnv): Promise<Response> {
  if (request.method !== "POST") return reply("報告はPOSTで送ってください", 405, { Allow: "POST" });
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin)
    return reply("このページから送信してください", 403);
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json")
    return reply("JSONで送信してください", 415);
  if (!env.VISITS || !env.REPORT_LIMITER)
    return reply("現在、報告を受け付けられません。時間をおいてお試しください", 503);
  let allowed;
  try {
    allowed = await env.REPORT_LIMITER.limit({
      key: request.headers.get("CF-Connecting-IP") ?? "unknown",
    });
  } catch {
    return reply("現在、報告を受け付けられません。時間をおいてお試しください", 503);
  }
  if (!allowed.success)
    return reply("短時間に報告が集中しています。1分後にお試しください", 429, {
      "Retry-After": "60",
    });
  // Content-Lengthは信用せず、実際の読み取りを4KiBまでに制限する。
  const reader = request.body?.getReader();
  if (!reader) return reply("報告の内容がありません", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      // ストリームは逐次読む。並列化すると本文の上限を守れない。
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        // 上限を越えた本文はその場で読み取りを止める。
        // eslint-disable-next-line no-await-in-loop
        await reader.cancel();
        return reply("報告が長すぎます。店名100文字・場所300文字以内で送信してください", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return reply("報告の形式が正しくありません", 400);
    }
    const parsed = ReportSchema.safeParse(body);
    if (!parsed.success)
      return reply(
        "種類と店の情報を確認してください。店名100文字・場所300文字以内で送信してください",
        400,
      );
    if ("shopId" in parsed.data && !ids.has(parsed.data.shopId))
      return reply("店舗が見つかりません。ページを再読み込みしてください", 400);
    await receiveReport(env.VISITS, parsed.data);
    return reply(REPORT_ACCEPTED, 201);
  } catch {
    // 自由記述やDBの例外をログに出さない。
    return reply("送信できませんでした。時間をおいてお試しください", 503);
  } finally {
    reader.releaseLock();
  }
}
