/**
 * デプロイの手順を見る。
 *
 * **`wrangler deploy` は migrations/ を見ない。** 別のコマンドで適用しない限り
 * 表は作られないので、新しいコードが「まだ無い表」を触って会員機能だけが落ちる。
 * 手元で 1 回叩いて済ませると、次に誰かが環境を作り直したときに再発する。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const { scripts } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { scripts: Record<string, string> };

describe("本番デプロイ", () => {
  it("表を作ってからコードを出す", () => {
    const apply = workflow.indexOf("npm run db:migrate");
    /*
     * **本当に出す行だけを見る。** このファイルには `wrangler deploy --dry-run`
     * （ビルドの確認）もあり、素直に探すとそちらに当たって順番を測り損ねる
     * （最初に書いたテストがそうなっていた）。
     */
    const deploy = workflow.search(/^\s*npx wrangler deploy$/m);

    expect(apply, "移行を適用する手順が無い").toBeGreaterThan(-1);
    expect(deploy, "デプロイする行が見つからない").toBeGreaterThan(-1);
    // 順番が逆だと、出た直後のリクエストが無い表を触る。
    expect(apply).toBeLessThan(deploy);
  });

  it("移行の適用先は wrangler.jsonc の D1 と同じ", () => {
    // 名前がずれると、別のデータベースに表を作って「適用済み」になる。
    // jsonc はコメントと末尾カンマを含むので、JSON として読まずに拾う。
    const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const name = config.match(/"database_name"\s*:\s*"([^"]+)"/)?.[1];

    expect(name, "wrangler.jsonc に D1 の名前が無い").toBeTruthy();
    expect(scripts["db:migrate"]).toContain(`wrangler d1 migrations apply ${name} --remote`);
  });

  it("手元から出すときも、表を作ってから出す", () => {
    /*
     * **CI だけ直しても足りない。** 新しい環境へ手元から `npm run deploy` した
     * とき、移行が適用されないと記録の tool が無い表を触る（README に
     * 「デプロイ時に自動で適用」と書いてあるのに適用されない状態だった）。
     */
    const deploy = scripts.deploy;
    expect(deploy).toContain("db:migrate");
    expect(deploy.indexOf("db:migrate")).toBeLessThan(deploy.indexOf("wrangler deploy"));
  });
});
