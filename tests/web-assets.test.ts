import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOAuthHarness } from "./fixtures/oauth-harness";

const assets = mkdtempSync(join(tmpdir(), "iekei-web-assets-"));
cpSync(new URL("../dist/web", import.meta.url), assets, { recursive: true });
// 認可やMCPと同名の静的ファイルが増えても、APIの応答を横取りさせない。
for (const name of ["mcp", "health", "whereami", "authorize", "token", "register"]) {
  writeFileSync(join(assets, `${name}.html`), "static-shadow");
}
const { harness, close } = createOAuthHarness(assets);
const request = (path: string, init?: RequestInit) =>
  harness.fetch(`http://localhost${path}`, { ...init, redirect: "manual" });

const call = (name: string) =>
  request("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: {} },
    }),
  });

beforeAll(async () => {
  await harness.listen();
}, 60_000);
afterAll(async () => {
  try {
    await close();
  } finally {
    rmSync(assets, { recursive: true, force: true });
  }
}, 30_000);

describe("workerdのWeb静的配信と既存API", () => {
  it("ルートのHTMLと参照先JS・CSSを配信する", async () => {
    const response = await request("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("家系ラーメンを地図で探す｜迷ったら3軒に絞れる");
    const paths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    expect(paths.some((p) => p.endsWith(".js"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".css"))).toBe(true);
    const responses = await Promise.all(paths.map((p) => request(p)));
    for (const asset of responses) expect(asset.status).toBe(200);
  });

  it.each(["facebookexternalhit/1.1", "Twitterbot/1.0"])(
    "%sにJS実行不要のリンク情報と静的PNGを配信する",
    async (userAgent) => {
      const response = await request("/", { headers: { "User-Agent": userAgent } });
      expect(response.status).toBe(200);
      const html = await response.text();
      const metadata = new Map(
        [...html.matchAll(/<meta\b[^>]*>/g)].map(([tag]) => [
          tag.match(/\b(?:name|property)="([^"]+)"/)?.[1],
          tag.match(/\bcontent="([^"]+)"/)?.[1],
        ]),
      );
      expect(metadata.get("description")).toContain("地図データをもとにした推定です。");
      expect(metadata.get("og:title")).toBe("家系ラーメンを地図で探す｜迷ったら3軒に絞れる");
      expect(metadata.get("og:description")).toBe(
        "今日の家系、決められない人へ。迷ったら3軒まで絞ります。",
      );
      expect(metadata.get("og:type")).toBe("website");
      expect(metadata.get("og:url")).toBe("https://iekeiramen.com/");
      expect(metadata.get("twitter:card")).toBe("summary_large_image");
      const imageUrl = metadata.get("og:image");
      expect(imageUrl).toBe("https://iekeiramen.com/og-card.png");
      expect(metadata.get("twitter:image")).toBe(imageUrl);
      expect(metadata.get("og:image:alt")).toBeTruthy();
      const image = await request(new URL(imageUrl!).pathname, {
        headers: { "User-Agent": userAgent },
      });
      expect(image.status).toBe(200);
      expect(image.headers.get("Content-Type")).toContain("image/png");
      const bytes = new Uint8Array(await image.arrayBuffer());
      expect(bytes.slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
      const png = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect(png.getUint32(16)).toBe(Number(metadata.get("og:image:width")));
      expect(png.getUint32(20)).toBe(Number(metadata.get("og:image:height")));
      expect([png.getUint32(16), png.getUint32(20)]).toEqual([1200, 630]);
    },
  );

  it("APIへのHTMLナビゲーションでも静的ファイルを返さない", async () => {
    const init = { headers: { Accept: "text/html", "Sec-Fetch-Mode": "navigate" } };
    const health = await request("/health", init);
    expect(await health.text()).toBe("ok");
    const location = await request("/whereami", init);
    expect(location.headers.get("Content-Type")).toContain("application/json");
    const authorize = await request("/authorize", init);
    expect(authorize.status).toBe(400);
    expect(await authorize.text()).not.toContain("static-shadow");
    for (const path of ["/mcp", "/token", "/register", "/callback/google"]) {
      const response = await request(path, init);
      expect(response.status).not.toBe(200);
      expect(await response.text()).not.toContain("static-shadow");
    }
    const metadata = await request("/.well-known/oauth-protected-resource/mcp", init);
    expect(await metadata.json()).toMatchObject({ resource: "http://localhost/mcp" });
  });

  it("同じoriginのMCPで匿名検索ができ、訪問記録は401になる", async () => {
    const search = await call("search-iekei-ramen");
    expect(search.status).toBe(200);
    expect(await search.text()).toContain("structuredContent");
    const stamp = await call("stamp-iekei-ramen");
    expect(stamp.status).toBe(401);
    expect(stamp.headers.get("WWW-Authenticate")).toContain("oauth-protected-resource");
  });

  it("未定義のURLとMCPの埋め込みHTML・ソースを静的公開しない", async () => {
    for (const path of ["/unknown", "/mcp-app.html", "/src/web.tsx"]) {
      const response = await request(path, {
        headers: { Accept: "text/html", "Sec-Fetch-Mode": "navigate" },
      });
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('<div id="root">');
    }
  });
});
