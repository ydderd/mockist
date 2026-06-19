import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

const script = join(import.meta.dirname, "../scripts/ci-trajectory-diff.mjs");

function runScript(args: string[] = []): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], { encoding: "utf8" });
    return { stdout, status: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? "", status: err.status ?? 1 };
  }
}

test("ci-trajectory-diff exits 0 and reports assertion failures", () => {
  const dir = mkdtempSync(join(tmpdir(), "mockist-ci-"));
  const path = join(dir, "results.json");
  writeFileSync(
    path,
    JSON.stringify({
      success: false,
      numFailedTests: 1,
      testResults: [
        {
          name: "test/foo.test.ts",
          status: "failed",
          assertionResults: [
            {
              status: "failed",
              fullName: "foo fails",
              failureMessages: ["expected true to be false"],
            },
          ],
        },
      ],
    }),
  );

  const { stdout, status } = runScript([path]);
  expect(status).toBe(0);
  expect(stdout).toContain("1 test(s) failed");
  expect(stdout).toContain("foo fails");
});

test("ci-trajectory-diff reports suite-level file failures", () => {
  const dir = mkdtempSync(join(tmpdir(), "mockist-ci-"));
  const path = join(dir, "results.json");
  writeFileSync(
    path,
    JSON.stringify({
      success: false,
      numFailedTests: 1,
      testResults: [{ name: "test/broken.test.ts", status: "failed", message: "Cannot find module" }],
    }),
  );

  const { stdout, status } = runScript([path]);
  expect(status).toBe(0);
  expect(stdout).toContain("test/broken.test.ts");
  expect(stdout).toContain("Cannot find module");
});
