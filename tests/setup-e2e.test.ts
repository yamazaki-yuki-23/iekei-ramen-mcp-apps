import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

// 実 Git と Node の subprocess を複数回起動するため、遅い CI でも 5 秒で落とさない。
const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "iekei-setup-"));
  roots.push(root);
  const upstream = join(root, "upstream");
  const project = join(root, "project");
  const bin = join(root, "bin");
  const log = join(root, "commands.jsonl");
  for (const dir of [upstream, join(project, "scripts"), bin]) mkdirSync(dir, { recursive: true });
  const git = (args: string[], cwd = upstream) =>
    execFileSync(realGit, args, { cwd, stdio: "pipe" });
  git(["init", "-q"]);
  mkdirSync(join(upstream, "examples/basic-host"), { recursive: true });
  writeFileSync(join(upstream, ".gitignore"), "node_modules/\ndist/\n");
  for (const version of ["2.0.0", "2.1.0"]) {
    writeFileSync(join(upstream, "examples/basic-host/package.json"), JSON.stringify({ version }));
    writeFileSync(join(upstream, "package-lock.json"), JSON.stringify({ version }));
    git(["add", "."]);
    git(["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", version]);
    git(["tag", `v${version}`]);
  }
  copyFileSync(
    new URL("../scripts/setup-e2e.mjs", import.meta.url),
    join(project, "scripts/setup-e2e.mjs"),
  );
  const setVersion = (version: string) =>
    writeFileSync(
      join(project, "package-lock.json"),
      JSON.stringify({
        packages: { "node_modules/@modelcontextprotocol/ext-apps": { version } },
      }),
    );
  setVersion("2.0.0");

  // Git は実際に使う。取得元だけをローカルのタグ付き repo へ置き換える。
  writeFileSync(
    join(bin, "git"),
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
appendFileSync(process.env.E2E_SETUP_LOG, JSON.stringify({cmd:'git',args})+'\\n');
const source = args.indexOf('https://github.com/modelcontextprotocol/ext-apps.git');
if(source>=0) args[source] = 'file://'+process.env.E2E_SETUP_UPSTREAM;
const result=spawnSync(process.env.E2E_SETUP_REAL_GIT,args,{stdio:'inherit'});
process.exit(result.status ?? 1);
`,
    { mode: 0o755 },
  );
  // npm の取得・ビルドだけを偽物にする。レジストリや公開 API は呼ばない。
  writeFileSync(
    join(bin, "npm"),
    `#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args=process.argv.slice(2);
appendFileSync(process.env.E2E_SETUP_LOG,JSON.stringify({cmd:'npm',args})+'\\n');
if(args[0]==='view') { console.log(process.env.E2E_SETUP_LATEST_VERSION); process.exit(0); }
if(['install','ci'].includes(args[0])) mkdirSync(join(process.cwd(),'node_modules'),{recursive:true});
if(args[0]==='run' && args[1]==='build') {
  if(process.env.E2E_SETUP_FAIL_BUILD==='1') process.exit(1);
  const version=JSON.parse(readFileSync('package.json','utf8')).version;
  mkdirSync('dist',{recursive:true});
  for(const file of ['index.html','sandbox.html']) writeFileSync(join('dist',file),version);
}
`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    E2E_SETUP_REAL_GIT: realGit,
    E2E_SETUP_UPSTREAM: upstream,
    E2E_SETUP_LOG: log,
    E2E_SETUP_LATEST_VERSION: "2.0.0",
  };
  const run = (extra: Record<string, string> = {}, args: string[] = []) =>
    spawnSync(process.execPath, [join(project, "scripts/setup-e2e.mjs"), ...args], {
      cwd: project,
      env: { ...env, ...extra },
      encoding: "utf8",
    });
  const commands = () =>
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { cmd: string; args: string[] });
  const repo = join(project, "e2e-host/ext-apps");
  const host = join(repo, "examples/basic-host");
  const builds = () =>
    commands().filter((command) => command.cmd === "npm" && command.args[0] === "run").length;
  return { run, setVersion, commands, git, repo, host, builds, log };
}

it("最新版の回答が 9.9.9 でも lockfile の v2.0.0 を取得する", () => {
  const f = fixture();
  const result = f.run({ E2E_SETUP_LATEST_VERSION: "9.9.9" });
  expect(result.status, result.stderr).toBe(0);
  expect(f.commands().some((command) => command.cmd === "npm" && command.args[0] === "view")).toBe(
    false,
  );
  expect(f.git(["describe", "--tags", "--exact-match"], f.repo).toString().trim()).toBe("v2.0.0");
}, 20_000);

it("cold と warm で同じ版・成果物を使い、warm は外部取得と再ビルドを省く", () => {
  const f = fixture();
  expect(f.run().status).toBe(0);
  const cold = f.commands();
  expect(f.run({ E2E_SETUP_LATEST_VERSION: "9.9.9" }).status).toBe(0);
  const warm = f.commands().slice(cold.length);
  expect(
    warm.some(
      (command) =>
        command.cmd === "npm" || command.args[0] === "fetch" || command.args[0] === "clone",
    ),
  ).toBe(false);
  expect(f.builds()).toBe(1);
  expect(readFileSync(join(f.host, "dist/index.html"), "utf8")).toBe("2.0.0");
}, 20_000);

it("lockfile の指定版変更で既存 checkout・依存・成果物を更新する", () => {
  const f = fixture();
  expect(f.run().status).toBe(0);
  f.setVersion("2.1.0");
  const result = f.run();
  expect(result.status, result.stderr).toBe(0);
  expect(f.git(["describe", "--tags", "--exact-match"], f.repo).toString().trim()).toBe("v2.1.0");
  expect(readFileSync(join(f.host, "dist/sandbox.html"), "utf8")).toBe("2.1.0");
  expect(f.builds()).toBe(2);
  expect(
    f.commands().filter((command) => command.cmd === "npm" && command.args[0] === "ci"),
  ).toHaveLength(2);
}, 20_000);

it("古い・欠けた成果物を、sandbox.html の有無だけで再利用しない", () => {
  const f = fixture();
  expect(f.run().status).toBe(0);
  writeFileSync(join(f.host, "dist/index.html"), "old build");
  expect(f.run().status).toBe(0);
  expect(readFileSync(join(f.host, "dist/index.html"), "utf8")).toBe("2.0.0");
  rmSync(join(f.host, "dist/index.html"));
  expect(f.run().status).toBe(0);
  expect(f.builds()).toBe(3);
}, 20_000);

it("checkout の手元の変更を上書きせず、場所を示して止まる", () => {
  const f = fixture();
  expect(f.run().status).toBe(0);
  writeFileSync(join(f.host, "package.json"), '{"version":"local edit"}');
  f.setVersion("2.1.0");
  const result = f.run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("未コミット");
  expect(readFileSync(join(f.host, "package.json"), "utf8")).toContain("local edit");
}, 20_000);

it("版変更後のビルドが失敗しても、次の実行で古い成果物を再利用しない", () => {
  const f = fixture();
  expect(f.run().status).toBe(0);
  f.setVersion("2.1.0");
  expect(f.run({ E2E_SETUP_FAIL_BUILD: "1" }).status).not.toBe(0);
  expect(readFileSync(join(f.host, "dist/sandbox.html"), "utf8")).toBe("2.0.0");
  expect(f.run().status).toBe(0);
  expect(readFileSync(join(f.host, "dist/sandbox.html"), "utf8")).toBe("2.1.0");
  expect(f.builds()).toBe(3);
}, 20_000);

it("--version は checkout や npm を実行せず、lockfile の固定版だけを返す", () => {
  const f = fixture();
  const result = f.run({}, ["--version"]);
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("2.0.0");
  expect(existsSync(f.repo)).toBe(false);
  expect(existsSync(f.log)).toBe(false);
}, 20_000);
