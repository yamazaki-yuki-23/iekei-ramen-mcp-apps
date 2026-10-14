/**
 * ChatGPT のディレクトリへの申請の中身（#47、submission/chatgpt/）。上限や形を外すと
 * アップロードの検査で止まるので、ここで先に見る。上限は developers.openai.com/plugins/deploy/submission。
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../submission/chatgpt/", import.meta.url);
const plugin = JSON.parse(readFileSync(new URL("plugin.json", dir), "utf8"));
const mcp = JSON.parse(readFileSync(new URL("mcp.json", dir), "utf8"));
const openai = plugin.extensions["com.openai"];
const ui = openai.interface;
const server = readFileSync(new URL("../server/server.ts", import.meta.url), "utf8");

describe("ChatGPT の申請の中身（#47）", () => {
  it("掲載の文が上限に収まる", () => {
    expect(plugin.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(plugin.name.length).toBeLessThanOrEqual(64);
    expect(ui.displayName.length).toBeLessThanOrEqual(30);
    expect(ui.shortDescription.length).toBeLessThanOrEqual(30);
    expect(ui.longDescription.length).toBeLessThanOrEqual(4000);
    expect(ui.developerName.length).toBeLessThanOrEqual(80);
    expect(ui.capabilities.length).toBeLessThanOrEqual(20);
    for (const c of ui.capabilities) expect(c.length).toBeLessThanOrEqual(120);
    expect(ui.defaultPrompt.length).toBeLessThanOrEqual(3);
    expect(new Set(ui.defaultPrompt).size).toBe(ui.defaultPrompt.length);
    for (const p of ui.defaultPrompt) expect(p.length).toBeLessThanOrEqual(128);
  });

  it("カテゴリは受け付けられる 13 種類のどれか（developers.openai.com/plugins/deploy/submission-errors）", () => {
    expect([
      "Productivity",
      "Creativity",
      "Developer Tools",
      "Business & Operations",
      "Data & Analytics",
      "Communication",
      "Education & Research",
      "Security",
      "Finance",
      "Healthcare",
      "Travel",
      "Entertainment",
      "Other",
    ]).toContain(ui.category);
    // 最終の申請では release notes も要る。
    expect(openai.publication.release_notes).toBeTruthy();
    expect(plugin.description.length).toBeLessThanOrEqual(1024);
  });

  it("審査に要る URL が本番の https を指す", () => {
    for (const key of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"])
      expect(ui[key]).toMatch(/^https:\/\/iekeiramen\.com(\/|$)/);
    const entry = mcp.mcpServers["iekei-ramen"];
    expect(entry).toMatchObject({ type: "streamable-http", url: "https://iekeiramen.com/mcp" });
    // 探すのは匿名、「行った店」だけ OAuth。混在（mixed）と宣言しないと審査で OAuth のケースを試せない。
    const auth = entry.extensions["com.openai"].auth;
    expect(auth).toMatchObject({ type: "mixed", client: { mode: "dcr" }, baseScopes: ["stamp"] });
    for (const key of ["registrationUrl", "authorizationUrl", "tokenUrl"])
      expect(auth[key]).toMatch(/^https:\/\/iekeiramen\.com\//);
  });

  it("参照する画像が ZIP に入る場所にある", () => {
    for (const key of ["logo", "composerIcon"]) {
      expect(ui[key]).toMatch(/^\.\//);
      expect(existsSync(new URL(ui[key], dir))).toBe(true);
    }
  });

  it("テストケースは正しく動く例 5 件・使わない例 3 件で、挙げた tool が実在する", () => {
    const { positive, negative } = openai.review.test_cases;
    expect(positive).toHaveLength(5);
    expect(negative).toHaveLength(3);
    for (const c of positive) {
      expect(c.description && c.prompt && c.expected_behavior).toBeTruthy();
      for (const tool of c.tools_triggered.split(",").map((t: string) => t.trim()))
        expect(server).toContain(`"${tool}"`);
    }
  });

  it("審査用のアカウントや審査の方へのメモを ZIP に入れない（申請画面で入れる）", () => {
    const text = JSON.stringify(plugin);
    for (const banned of ["test_credentials", "reviewer_instructions", "password", "clientSecret"])
      expect(text).not.toContain(banned);
  });
});
