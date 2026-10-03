/**
 * scripts/wait-codex-review.sh の「届いた」の見分け方。
 *
 * 偽の gh（tests/fixtures/fake-gh）に GitHub の応答を持たせて流す。**ここを
 * 間違えると、レビューされていないコミットを「指摘なし」としてマージする。**
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = "o/r";
const PR = "70";
const BOT = "chatgpt-codex-connector[bot]";
const OLD = "1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEAD = "2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

type Fixture = Record<string, unknown>;

function run(fixture: Fixture) {
  const dir = mkdtempSync(join(tmpdir(), "wait-codex-"));
  const file = join(dir, "fixture.json");
  writeFileSync(file, JSON.stringify(fixture));
  return spawnSync("bash", ["scripts/wait-codex-review.sh", PR], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${new URL("fixtures/fake-gh", import.meta.url).pathname}:${process.env.PATH}`,
      FAKE_GH_FIXTURE: file,
      // 届かない場合は 1 回見て諦める（待たない）。
      CODEX_WAIT_TIMEOUT: "0",
    },
  });
}

/** 依頼が 1 本・指摘も総評も無い PR。 */
const base = (request: { at: string; thumbsUp: boolean }): Fixture => ({
  repo: { nameWithOwner: REPO },
  pr: { headRefOid: HEAD },
  [`repos/${REPO}/pulls/${PR}/reviews`]: [],
  [`repos/${REPO}/pulls/${PR}/comments`]: [],
  [`repos/${REPO}/issues/${PR}/comments`]: [
    { id: 9, body: "@codex review", created_at: request.at, user: { login: "me" } },
  ],
  [`repos/${REPO}/issues/comments/9/reactions`]: request.thumbsUp
    ? [{ content: "+1", user: { login: BOT } }]
    : [],
});

describe("wait-codex-review.sh — 届いたかの見分け方", () => {
  it("総評の Completed の行に今の SHA があれば、指摘なしで届いた（exit 0）", () => {
    const fixture = base({ at: "2026-10-03T10:05:00Z", thumbsUp: false });
    fixture[`repos/${REPO}/issues/${PR}/comments`] = [
      { id: 9, body: "@codex review", created_at: "2026-10-03T10:05:00Z", user: { login: "me" } },
      {
        id: 10,
        updated_at: "2026-10-03T10:09:00Z",
        body: `| Code Review | ✅ **Completed** | \`${HEAD.slice(0, 7)}\` |\nCodex Review: Didn't find any major issues.`,
        user: { login: BOT },
      },
    ];
    const r = run(fixture);
    expect(r.stdout).toContain("未返信の指摘: なし");
    expect(r.status).toBe(0);
  });

  it.each([
    ["head より後の依頼", "2026-10-03T10:05:00Z"],
    ["head より前の依頼", "2026-10-03T09:50:00Z"],
  ])("%sの 👍 だけでは届いたとみなさない", (_, at) => {
    /*
     * 👍 は SHA を持たない。前の巡の 👍 の後に push したコミットも、コミットの日時は
     * 依頼より前になりうる（溜めていたコミット・作り直し）。どちらでも待ち続ける。
     */
    expect(run(base({ at, thumbsUp: true })).status).toBe(4);
  });

  it("総評の Running の行に SHA があるだけでは届いていない", () => {
    const fixture = base({ at: "2026-10-03T10:05:00Z", thumbsUp: false });
    fixture[`repos/${REPO}/issues/${PR}/comments`] = [
      { id: 9, body: "@codex review", created_at: "2026-10-03T10:05:00Z", user: { login: "me" } },
      {
        id: 10,
        updated_at: "2026-10-03T10:06:00Z",
        body: `| Code Review | 🔄 **Running** | \`${HEAD.slice(0, 7)}\` |`,
        user: { login: BOT },
      },
    ];
    expect(run(fixture).status).toBe(4);
  });

  it("指摘ありは review の commit_id で届き、未返信の指摘を出す（exit 3）", () => {
    const fixture = base({ at: "2026-10-03T10:05:00Z", thumbsUp: false });
    fixture[`repos/${REPO}/pulls/${PR}/reviews`] = [
      { commit_id: OLD, submitted_at: "2026-10-03T09:00:00Z", user: { login: BOT } },
      { commit_id: HEAD, submitted_at: "2026-10-03T10:09:00Z", user: { login: BOT } },
    ];
    fixture[`repos/${REPO}/pulls/${PR}/comments`] = [
      {
        id: 1,
        in_reply_to_id: null,
        path: "a.ts",
        line: 3,
        body: "old, replied",
        user: { login: BOT },
      },
      { id: 2, in_reply_to_id: 1, body: "fixed", user: { login: "me" } },
      {
        id: 3,
        in_reply_to_id: null,
        path: "b.ts",
        line: 7,
        body: "new finding",
        user: { login: BOT },
      },
    ];
    const r = run(fixture);
    expect(r.status).toBe(3);
    expect(r.stdout).toContain("id=3 b.ts:7");
    expect(r.stdout).not.toContain("id=1");
  });

  it("同じ head への前の巡の結果は、依頼し直した後の到着とみなさない", () => {
    /*
     * コードを変えずに指摘へ反論して依頼し直すと、head は同じ。前の巡の review と
     * Completed の行が残っているので、時刻を見ないと即座に「届いた」になり、返信済みの
     * 指摘しか無いので exit 0（指摘なし）でマージへ進む。
     */
    const fixture = base({ at: "2026-10-03T10:30:00Z", thumbsUp: false });
    fixture[`repos/${REPO}/pulls/${PR}/reviews`] = [
      { commit_id: HEAD, submitted_at: "2026-10-03T10:09:00Z", user: { login: BOT } },
    ];
    fixture[`repos/${REPO}/issues/${PR}/comments`] = [
      { id: 8, body: "@codex review", created_at: "2026-10-03T10:05:00Z", user: { login: "me" } },
      {
        id: 10,
        updated_at: "2026-10-03T10:09:00Z",
        body: `| Code Review | ✅ **Completed** | \`${HEAD.slice(0, 7)}\` |`,
        user: { login: BOT },
      },
      { id: 9, body: "@codex review", created_at: "2026-10-03T10:30:00Z", user: { login: "me" } },
    ];
    expect(run(fixture).status).toBe(4);
  });
});
