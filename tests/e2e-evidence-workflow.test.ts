import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const workflow = parse(
  readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
);
const steps = workflow.jobs["e2e-shard"].steps as Array<{
  id?: string;
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
}>;
const upload = steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"))!;

describe("E2Eの再試行の証跡", () => {
  it.each([
    { outcome: "success", jobFailed: false, uploadExpected: true },
    { outcome: "failure", jobFailed: true, uploadExpected: true },
    { outcome: "skipped", jobFailed: false, uploadExpected: false },
    { outcome: "", jobFailed: true, uploadExpected: false },
  ])(
    "E2E=$outcome、ジョブ失敗=$jobFailedの場合の証跡保存",
    ({ outcome, jobFailed, uploadExpected }) => {
      expect(steps.some((step) => step.id === "e2e-tests")).toBe(true);
      // このworkflowの条件を各outcomeで実行する。failure()だけへの退行も検出する。
      const condition = upload.if!.replaceAll("steps.e2e-tests", 'steps["e2e-tests"]');
      expect(
        runInNewContext(
          condition,
          { always: () => true, failure: () => jobFailed, steps: { "e2e-tests": { outcome } } },
          { timeout: 100 },
        ),
      ).toBe(uploadExpected);
      expect(upload.with?.path).toContain("playwright-report/");
      expect(upload.with?.path).toContain("test-results/");
      expect(upload.with?.["if-no-files-found"]).toBe("error");
    },
  );
});
