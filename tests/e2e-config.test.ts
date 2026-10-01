/**
 * E2E の設定を見る。
 *
 * **E2E から公開の Nominatim へ問い合わせない。** CI は E2E を 2 つのジョブ（別々の
 * マシン）に分けて同時に流し、PR が重なればワークフローごと同時に走る。手元の
 * サーバーの列ではそれらを並べられず、全体で 1 秒 1 回の規約を破る。
 *
 * ここが外れても E2E は落ちない——公開の Nominatim に問い合わせ直して通ってしまう。
 * だから設定そのものを見張る。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = readFileSync(new URL("../playwright.config.ts", import.meta.url), "utf8");

describe("E2E のサーバー", () => {
  it("main.ts を立てるサーバーは、どれも地名の解決を決まった応答で返す", () => {
    // webServer の 1 件ずつ（`command:` から次の `command:` の手前まで）。
    const servers = config.split(/(?=^\s*command:)/m).filter((s) => /command:.*main\.ts/.test(s));
    expect(servers.length, "main.ts を立てるサーバーが見つからない").toBeGreaterThanOrEqual(2);
    for (const server of servers) {
      expect(server, "地名の解決が公開サーバーへ出ていく").toMatch(/IEKEI_GEOCODE_FIXTURE:/);
    }
  });

  it("決まった応答のファイルがある", () => {
    const path = config.match(/GEOCODE_FIXTURE = "([^"]+)"/)?.[1];
    expect(path).toBeDefined();
    const fixture = JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
    // E2E の地名検索はどれも「横浜駅」。
    expect(fixture["横浜駅"]?.[0]).toMatchObject({
      lat: expect.any(String),
      lon: expect.any(String),
    });
  });
});
