import { d1Visits } from "../../src/lib/visits";

type Operation =
  | { action: "list" | "clear"; visitorId: string }
  | { action: "set"; visitorId: string; shopId: string; visited: boolean };

// テスト専用の入口。SQL実装は本番と同じものをworkerdの中で呼ぶ。
export default {
  async fetch(request: Request, env: { VISITS: D1Database }) {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const operation = (await request.json()) as Operation;
    const visits = d1Visits(env.VISITS);
    switch (operation.action) {
      case "list":
        return Response.json(await visits.list(operation.visitorId));
      case "set":
        return Response.json(
          await visits.set(operation.visitorId, operation.shopId, operation.visited),
        );
      case "clear":
        await visits.clear(operation.visitorId);
        return Response.json(null);
    }
  },
};
