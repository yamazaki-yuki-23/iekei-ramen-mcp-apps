import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("再試行成功でも最初の失敗のtrace・画像・frame履歴・HTMLを保持する", async () => {
  const dir = await mkdtemp(join(tmpdir(), "iekei-e2e-evidence-"));
  const run = promisify(execFile);
  const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
  try {
    await writeFile(
      join(dir, "config.ts"),
      `
      import config from ${JSON.stringify(resolve("playwright.config.ts"))};
      export default {...config, testDir:${JSON.stringify(dir)}, testMatch:'probe.spec.ts',
        retries:1, workers:1, fullyParallel:false, webServer:[],
        outputDir:${JSON.stringify(join(dir, "test-results"))},
        reporter:[['html',{open:'never',outputFolder:${JSON.stringify(join(dir, "playwright-report"))}}],
          ['json',{outputFile:${JSON.stringify(join(dir, "test-results/results.json"))}}]]};
    `,
    );
    await writeFile(
      join(dir, "probe.spec.ts"),
      `
      import {test} from ${JSON.stringify(resolve("e2e/fixtures.ts"))};
      test('first attempt fails',async({page},info)=>{
        await page.setContent('<iframe src="data:text/html,<p>probe</p><!--inline-credential-probe-->"></iframe>');
        await page.frameLocator('iframe').getByText('probe').waitFor();
        if(info.retry===0)throw new Error('intentional first-attempt failure');
      });
    `,
    );
    await run(process.execPath, [cli, "test", "--config", join(dir, "config.ts")], {
      cwd: dir,
      timeout: 20_000,
    });
    const report = JSON.parse(await readFile(join(dir, "test-results/results.json"), "utf8"));
    const attempts = report.suites[0].specs[0].tests[0].results as Array<{
      status: string;
      attachments: Array<{ name: string; path?: string; body?: string }>;
    }>;
    expect(attempts.map((attempt) => attempt.status)).toEqual(["failed", "passed"]);
    const failed = attempts[0];
    for (const name of ["trace", "screenshot", "frame-lifecycle"]) {
      const attachment = failed.attachments.find((item) => item.name === name);
      expect(attachment, `最初の失敗の${name}が無い`).toBeDefined();
      const contents = attachment!.path
        ? await readFile(attachment!.path)
        : Buffer.from(attachment!.body!, "base64");
      expect(contents.byteLength).toBeGreaterThan(0);
      await test.info().attach(`retry-probe-first-${name}`, {
        body: contents,
        contentType:
          name === "trace"
            ? "application/zip"
            : name === "screenshot"
              ? "image/png"
              : "application/json",
      });
    }
    const frameLog = failed.attachments.find((item) => item.name === "frame-lifecycle")!;
    const evidence = JSON.parse(
      frameLog.path
        ? await readFile(frameLog.path, "utf8")
        : Buffer.from(frameLog.body!, "base64").toString("utf8"),
    );
    expect(evidence.retry).toBe(0);
    expect(evidence.events.some((event: { event: string }) => event.event === "attached")).toBe(
      true,
    );
    expect(evidence.events.some((event: { location?: string }) => event.location === "data:")).toBe(
      true,
    );
    expect(JSON.stringify(evidence)).not.toContain("inline-credential-probe");
    expect((await readFile(join(dir, "playwright-report/index.html"))).byteLength).toBeGreaterThan(
      0,
    );
    // 子テストのtempを片付けても、CIが保存する親のtest-results配下には証跡を残す。
    await cp(join(dir, "playwright-report"), test.info().outputPath("retry-probe-report"), {
      recursive: true,
    });
    await test.info().attach("retry-probe-results", {
      path: join(dir, "test-results/results.json"),
      contentType: "application/json",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
