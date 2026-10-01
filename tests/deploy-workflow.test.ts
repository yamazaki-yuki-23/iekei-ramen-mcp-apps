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

/**
 * E2E は 2 つのジョブに分けて流し、必須チェックの名前は取りまとめのジョブが名乗る。
 *
 * **取りまとめが黙ってスキップされると、落ちた E2E が必須チェックを素通りする。**
 * GitHub はスキップした必須チェックを「通った」と扱う。`if: always()` で必ず走らせ、
 * 分けたジョブの結果を自分で確かめる。どちらかを外しても、見た目には何も壊れない。
 */
describe("E2E の取りまとめ", () => {
  /** `  e2e:` から次のジョブの手前まで。 */
  const job = (() => {
    const start = workflow.search(/^ {2}e2e:$/m);
    const rest = workflow.slice(start + 1);
    const next = rest.search(/^ {2}\S[^:]*:$/m);
    return start === -1 ? "" : workflow.slice(start, next === -1 ? undefined : start + 1 + next);
  })();

  it("必須チェックの名前を名乗る", () => {
    expect(job, "取りまとめのジョブが無い").not.toBe("");
    expect(job).toMatch(/^ {4}name: E2E \(Playwright\)$/m);
  });

  it("分けたジョブが落ちても、スキップされずに走る", () => {
    expect(job).toMatch(/^ {4}if: always\(\)$/m);
  });

  it("分けたジョブの結果が success でなければ落ちる", () => {
    expect(job).toMatch(/needs\.e2e-shard\.result/);
    expect(job).toMatch(/test "\$RESULT" = "success"/);
  });
});
