/**
 * issue のテンプレート（.github/ISSUE_TEMPLATE/*.yml）を見る。
 *
 * **書式が崩れたテンプレートは、GitHub の「New issue」から黙って消える。**
 * エラーはどこにも出ないので、ここで形を確かめる。種類ラベルは LABELS.md の
 * 「種類」の表にあるものに限る（/create-issue が両方を読んで突き合わせるため）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const DIR = new URL("../.github/ISSUE_TEMPLATE/", import.meta.url);
const labelsDoc = readFileSync(new URL("../.github/LABELS.md", import.meta.url), "utf8");

/** LABELS.md の「種類」の表に並んでいるラベル。 */
const kinds = (() => {
  const section = labelsDoc.split(/^## /m).find((s) => s.startsWith("種類")) ?? "";
  return [...section.matchAll(/^\| `([^`]+)`/gm)].map((m) => m[1]);
})();

interface Field {
  type: string;
  id?: string;
  attributes: { label: string; value?: string };
  validations?: { required?: boolean };
}
const templates = readdirSync(DIR)
  .filter((f) => f.endsWith(".yml"))
  .map((f) => ({
    file: f,
    ...(YAML.parse(readFileSync(new URL(f, DIR), "utf8")) as {
      name: string;
      description: string;
      labels: string[];
      body: Field[];
    }),
  }));

describe("issue のテンプレート", () => {
  it("5 種類ある", () => {
    expect(templates.map((t) => t.labels[0]).toSorted()).toEqual([
      "bug",
      "chore",
      "enhancement",
      "epic",
      "research",
    ]);
  });

  it.each(templates.map((t) => [t.file, t] as const))("%s は GitHub が読める形", (_, t) => {
    /*
     * **名前は 3 文字以上。** 短いと GitHub はテンプレートを無効として扱い、
     * 「New issue」に出さない。エラーはファイルの画面にしか出ない（実測:
     * 「機能」「調査」「作業」「親」の 4 つが Name is too short で無効になり、
     * 出ていたのは 3 文字の「不具合」だけだった）。
     */
    expect([...t.name].length, `名前「${t.name}」が短い`).toBeGreaterThanOrEqual(3);
    expect(t.description).toBeTruthy();
    const ids = t.body.map((b) => b.id);
    expect(new Set(ids).size, "id が重なっている").toBe(ids.length);
    for (const b of t.body) {
      expect(["markdown", "textarea", "input", "dropdown", "checkboxes"]).toContain(b.type);
      expect(b.attributes.label).toBeTruthy();
    }
  });

  it.each(templates.map((t) => [t.file, t] as const))(
    "%s の種類ラベルは、LABELS.md の種類にある",
    (_, t) => {
      expect(kinds.length, "LABELS.md の種類の表を読めていない").toBeGreaterThan(0);
      expect(t.labels).toHaveLength(1);
      expect(kinds).toContain(t.labels[0]);
    },
  );

  it.each(templates.filter((t) => t.labels[0] !== "epic").map((t) => [t.file, t] as const))(
    "%s の完了条件は必須で、チェックボックスで書き始める",
    (_, t) => {
      const done = t.body.find((b) => b.attributes.label === "完了条件");
      expect(done?.validations?.required).toBe(true);
      expect(done?.attributes.value?.trimStart()).toMatch(/^- \[ \]/);
    },
  );
});

/**
 * リポジトリに入れたスキルの先頭の設定（frontmatter）が、YAML として読めること。
 *
 * **Claude Code は寛容に読むので、壊れていても動いてしまう。** `description` の
 * `Use when: …` のように「コロンと空白」を引用符なしで書くと、厳密な YAML では
 * 読めない。ほかの道具がこの設定を読むと、そこで止まる。
 */
describe("/create-issue スキル", () => {
  it("先頭の設定が YAML として読める", () => {
    const skill = readFileSync(
      new URL("../.claude/skills/create-issue/SKILL.md", import.meta.url),
      "utf8",
    );
    const frontmatter = skill.split(/^---$/m)[1] ?? "";
    const parsed = YAML.parse(frontmatter) as { name?: string; description?: string };
    expect(parsed.name).toBe("create-issue");
    expect(parsed.description).toMatch(/Use when:/);
  });
});

describe("/create-issue の手順", () => {
  const skill = readFileSync(
    new URL("../.claude/skills/create-issue/SKILL.md", import.meta.url),
    "utf8",
  );

  it("親が epic かを、本文を書く前に確かめる", () => {
    /*
     * 作ってから確かめると、`親:` の行が本文に残ったまま作られる（試しに作ったとき、
     * 作業の #51 を親に指定し、作った後で行を外す羽目になった）。
     */
    const check = skill.indexOf('index("epic")');
    const write = skill.indexOf("### 3. 本文を書く");
    const create = skill.indexOf("### 4. 作る");
    expect(check, "親が epic かを確かめる手順が無い").toBeGreaterThan(-1);
    expect(check, "本文を書いた後に確かめている").toBeLessThan(write);
    expect(write).toBeLessThan(create);
  });

  it("位置引数（$1 など）を書かない", () => {
    /*
     * スキルを引数付きで呼ぶと、本文の `$1` が呼んだときの引数で置き換わる
     * （実際に `issues/$1` が `issues/issue` になり、id を取れなかった）。
     */
    expect(skill).not.toMatch(/\$(?:\d|ARGUMENTS\b)/);
  });

  it("作るときに段階（マイルストーン）を付ける", () => {
    const create = skill.slice(skill.indexOf("### 4. 作る"), skill.indexOf("### 5."));
    expect(create).toMatch(/gh issue create[\s\S]*--milestone/);
  });

  it("親はサブ issue で繋ぎ、本文にも親のチェックリストにも書かない", () => {
    /*
     * 親子はサブ issue が持つ。本文の `親: #番号` や親のチェックリストにも書くと
     * 二重になり、子を別の親へ移したときに片方だけ古くなる。
     */
    expect(skill).toMatch(/\/sub_issues"/);
    expect(skill, "親のチェックリストに足す手順が残っている").not.toMatch(
      /チェックリストに「- \[ \]/,
    );
    expect(skill, "本文に親を書く手順が残っている").not.toMatch(
      /本文の最後の行に `親: #番号` を書く/,
    );
  });
});

describe("リポジトリに置くスキル", () => {
  const names = ["create-issue", "codex-review-loop", "squash-and-merge", "ship-issue"];

  it.each(names)("%s は位置引数（ドル記号と数字）を書かない", (name) => {
    // 引数付きで呼ぶと本文の `$1` が置き換わる（上の create-issue で踏んだ）。
    const skill = readFileSync(
      new URL(`../.claude/skills/${name}/SKILL.md`, import.meta.url),
      "utf8",
    );
    expect(skill).not.toMatch(/\$(?:\d|ARGUMENTS\b)/);
  });

  it.each(names)("%s は先頭の設定が YAML として読め、名前が合っている", (name) => {
    // 引用符なしの `Use when: …` は厳密な YAML で読めず、スキルとして見つからなくなる。
    const skill = readFileSync(
      new URL(`../.claude/skills/${name}/SKILL.md`, import.meta.url),
      "utf8",
    );
    const parsed = YAML.parse(skill.split(/^---$/m)[1] ?? "") as { name?: string };
    expect(parsed.name).toBe(name);
  });

  it.each(names)("%s は .gitignore から外してある", (name) => {
    // 外し忘れると手元にだけ残り、直した手順がほかの作業場所に届かない。
    const ignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
    expect(ignore).toContain(`!.claude/skills/${name}/`);
  });
});
