/**
 * 置き場と名前の決まり（docs/development/structure.md）のうち、lint で書けないものを確かめる。
 * `.ts`・`.tsx` の名前の書き方（kebab-case・PascalCase）と import の向きは lint（.oxlintrc.json）、
 * 使う範囲は tests/structure-scope.test.ts が見張る。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const KINDS = ["components", "hooks", "lib", "utils", "types", "styles"];
const TOP = new Set(["features", ...KINDS, "generated"]);

/**
 * サブフォルダを作ってよい所と、まとめる外部のライブラリ。決まり: 1 つの外部のライブラリにまとまるものだけ。
 * 中の .ts・.tsx は全部、そのライブラリを直接か、import をたどって使う（部品専用の CSS は数えない）。
 * いまは無い（Leaflet を使う部品は MapView だけなので、components/ の直下に置いている）。
 */
const SUBFOLDERS: Record<string, string> = {};

const isDir = (path: string) => statSync(join(ROOT, path)).isDirectory();
const list = (dir: string) => (existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir)) : []);
function walkAll(dir: string): string[] {
  return list(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    return isDir(path) ? walkAll(path) : [path];
  });
}
/** ソースのファイル。隣に置いた単体テスト（*.test.ts）は数えない（置き場と名前の決まりは別に見る）。 */
const walk = (dir: string) => walkAll(dir).filter((path) => !path.endsWith(".test.ts"));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const pascal = (kebab: string) =>
  kebab.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());

const features = list("src/features").filter((name) => isDir(`src/features/${name}`));
/** 種類のフォルダ（トップと各機能の components/・hooks/ など）。 */
const kindDirs = [
  ...KINDS.map((kind) => `src/${kind}`),
  ...features.flatMap((f) => KINDS.map((kind) => `src/features/${f}/${kind}`)),
].filter((dir) => existsSync(join(ROOT, dir)));
const filesIn = (kind: string) =>
  kindDirs.filter((dir) => basename(dir) === kind).flatMap((dir) => walk(dir));

/** 値として export している名前（型は数えない）。 */
const valueExports = (text: string) =>
  [
    ...text.matchAll(
      /^export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_]+)/gm,
    ),
  ].map((match) => match[1]);

describe("置き場と名前の決まり（docs/development/structure.md）", () => {
  it("src/ のトップには、決まったフォルダだけがあり、ファイルは無い", () => {
    const extra = list("src").filter((name) => !isDir(`src/${name}`) || !TOP.has(name));
    expect(extra).toEqual([]);
  });

  it("機能の直下には、入口・<機能名>App.tsx・種類のフォルダだけがある", () => {
    const extra = features.flatMap((f) =>
      list(`src/features/${f}`)
        .filter((name) => !name.endsWith(".test.ts"))
        .filter((name) =>
          isDir(`src/features/${f}/${name}`)
            ? !KINDS.includes(name)
            : !/^main(-[a-z]+)?\.tsx$/.test(name) && name !== `${pascal(f)}App.tsx`,
        )
        .map((name) => `src/features/${f}/${name}`),
    );
    expect(extra).toEqual([]);
  });

  it("サブフォルダは、決めた所（1 つの外部のライブラリのまとまり）にだけあり、中でそのライブラリを使う", () => {
    const subfolders = kindDirs.flatMap((dir) =>
      list(dir)
        .filter((name) => isDir(`${dir}/${name}`))
        .map((name) => `${dir}/${name}`),
    );
    expect(subfolders.filter((dir) => !(dir in SUBFOLDERS))).toEqual([]);
    for (const [dir, library] of Object.entries(SUBFOLDERS)) {
      const uses = (file: string, seen = new Set<string>()): boolean => {
        if (seen.has(file)) return false;
        seen.add(file);
        const text = read(file);
        if (text.includes(`"${library}"`)) return true;
        return [...text.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)].some((match) => {
          const base = join(dirname(file), match[1]);
          const target = ["", ".ts", ".tsx"]
            .map((ext) => base + ext)
            .find((p) => existsSync(join(ROOT, p)) && !isDir(p));
          return target ? uses(target, seen) : false;
        });
      };
      const unrelated = walk(dir).filter((file) => /\.(ts|tsx)$/.test(file) && !uses(file));
      expect(unrelated, `${dir} の中で ${library} を使わないファイル`).toEqual([]);
    }
  });

  it("hooks/ のファイルは use-<名前>.ts で、use<名前> のフックを 1 つだけ export する", () => {
    const bad = filesIn("hooks").flatMap((file) => {
      const name = basename(file);
      if (!/^use-[a-z0-9-]+\.ts$/.test(name)) return [`${file}: 名前が use-<名前>.ts でない`];
      const expected = pascal(name.replace(/\.ts$/, "")).replace(/^Use/, "use");
      const exported = valueExports(read(file));
      return exported.length === 1 && exported[0] === expected
        ? []
        : [`${file}: export が ${JSON.stringify(exported)}（${expected} だけにする）`];
    });
    expect(bad).toEqual([]);
  });

  it("components/ の .tsx と <機能名>App.tsx は、ファイル名と同じ名前の部品を 1 つだけ export する", () => {
    // 機能の直下の <機能名>App.tsx も部品なので、同じ決まりで見る
    const appFiles = features
      .map((f) => `src/features/${f}/${pascal(f)}App.tsx`)
      .filter((p) => existsSync(join(ROOT, p)));
    const bad = [...filesIn("components"), ...appFiles]
      .filter((file) => file.endsWith(".tsx"))
      .flatMap((file) => {
        const expected = basename(file, ".tsx");
        // 部品は PascalCase（小文字を含む）。定数（SCREAMING_CASE）は数えない
        const parts = valueExports(read(file)).filter((name) => /^[A-Z][a-z]/.test(name));
        return parts.length === 1 && parts[0] === expected
          ? []
          : [`${file}: 部品の export が ${JSON.stringify(parts)}（${expected} だけにする）`];
      });
    expect(bad).toEqual([]);
  });

  it("CSS は決まった名前で決まった所にある", () => {
    const bad = walk("src")
      .filter((file) => file.endsWith(".css"))
      .flatMap((file) => {
        const name = basename(file);
        const dir = dirname(file);
        if (basename(dir) === "components") {
          // 部品専用: <部品名>.module.css を部品の隣に
          const part = name.replace(/\.module\.css$/, "");
          return /^[A-Z][A-Za-z0-9]*\.module\.css$/.test(name) &&
            existsSync(join(ROOT, dir, `${part}.tsx`))
            ? []
            : [`${file}: 部品専用の CSS は <部品名>.module.css で、部品の隣に置く`];
        }
        if (basename(dir) !== "styles") return [`${file}: CSS は styles/ か、部品の隣に置く`];
        const feature = /^src\/features\/([^/]+)\/styles$/.exec(dir)?.[1];
        if (!feature)
          return /^[a-z0-9-]+\.css$/.test(name)
            ? []
            : [`${file}: 全ページ共通の CSS は kebab-case の .css`];
        if (/^main(-[a-z]+)?\.css$/.test(name))
          return existsSync(join(ROOT, dirname(dir), name.replace(/\.css$/, ".tsx")))
            ? []
            : [`${file}: 入口だけが読む CSS は、同じ名前の入口があるときだけ`];
        return name === `${feature}.module.css`
          ? []
          : [
              `${file}: 機能の CSS は ${feature}.module.css か、入口だけが読む main.css・main-<場所>.css`,
            ];
      });
    expect(bad).toEqual([]);
  });

  it("サーバーが返す画面だけが読む CSS は server/styles/ に kebab-case で置く", () => {
    const bad = walk("server").filter(
      (file) => file.endsWith(".css") && !/^server\/styles\/[a-z0-9-]+\.css$/.test(file),
    );
    expect(bad).toEqual([]);
  });

  it("入口は main.tsx が 1 つだけか、main-<場所>.tsx が 2 つ以上（main.tsx は置かない）", () => {
    const bad = features.flatMap((f) => {
      const entries = list(`src/features/${f}`).filter((name) =>
        /^main(-[a-z]+)?\.tsx$/.test(name),
      );
      const single = entries.length === 1 && entries[0] === "main.tsx";
      const several = entries.length >= 2 && entries.every((name) => name !== "main.tsx");
      return single || several ? [] : [`src/features/${f}: 入口が ${JSON.stringify(entries)}`];
    });
    expect(bad).toEqual([]);
  });

  it("フック（use で始まる export）は hooks/ にだけある", () => {
    const bad = walk("src")
      .filter((file) => /\.(ts|tsx)$/.test(file) && !/\/hooks\//.test(file))
      .filter((file) => valueExports(read(file)).some((name) => /^use[A-Z]/.test(name)))
      .map((file) => `${file}: フックは hooks/ へ`);
    expect(bad).toEqual([]);
  });

  it("server/ の直下には、入口（worker.ts・main.ts）と登録の server.ts・種類のフォルダだけがある", () => {
    const allowed = new Set(["worker.ts", "main.ts", "server.ts", "tools", ...KINDS]);
    const extra = list("server").filter((name) => !allowed.has(name) && !name.endsWith(".test.ts"));
    expect(extra).toEqual([]);
  });

  it("server/tools/<名前>.ts は、その名前の tool を 1 つだけ登録する", () => {
    const bad = walk("server/tools").flatMap((file) => {
      const names = [
        ...read(file).matchAll(/register(?:App)?Tool\(\s*(?:server,\s*)?"([^"]+)"/g),
      ].map((match) => match[1]);
      const expected = basename(file, ".ts");
      return names.length === 1 && names[0] === expected
        ? []
        : [`${file}: 登録している tool が ${JSON.stringify(names)}（${expected} だけにする）`];
    });
    expect(bad).toEqual([]);
    expect(walk("server/tools").length).toBeGreaterThan(0);
  });

  it("ソースの隣の単体テストは <ソース名>.test.ts で、同じ名前のソースが隣にある", () => {
    const bad = [...walkAll("src"), ...walkAll("server")]
      .filter((file) => file.endsWith(".test.ts"))
      .filter((file) => {
        const base = file.replace(/\.test\.ts$/, "");
        return !existsSync(join(ROOT, `${base}.ts`)) && !existsSync(join(ROOT, `${base}.tsx`));
      });
    expect(bad).toEqual([]);
  });

  it("調べる対象が見つかっている（たどり方が壊れていない）", () => {
    expect(features).toEqual(expect.arrayContaining(["search", "match", "camera", "shindan"]));
    expect(filesIn("hooks").length).toBeGreaterThan(5);
    expect(filesIn("components").length).toBeGreaterThan(20);
  });
});
