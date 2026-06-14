import { afterAll, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness } from "../src/core/harness";
import { expectCassetteFullyUsed, cassetteExpectedCalls } from "../src/core/assert";
import { expectExactTrajectory } from "../src/core/assert";
import { CASSETTE_FORMAT_VERSION } from "../src/core/cassette/format";

const dir = mkdtempSync(join(tmpdir(), "mockist-report-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function cassetteFile(name: string, calls: unknown[]): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify({ mockist_format_version: CASSETTE_FORMAT_VERSION, calls }));
  return path;
}

test("expectCassetteFullyUsed passes when all entries used and no misses", async () => {
  const path = cassetteFile("full.json", [{ name: "w", input: { c: "P" }, output: 1 }]);
  const harness = createHarness({ cassette: path });
  await harness.dispatch("tool", "w", { c: "P" }, async () => 0);
  expect(expectCassetteFullyUsed(harness.cassetteState()).pass).toBe(true);
});

test("expectCassetteFullyUsed fails and reports misses and unused entries", async () => {
  const path = cassetteFile("partial.json", [{ name: "w", input: { c: "P" }, output: 1 }]);
  const harness = createHarness({ cassette: path });
  await harness.dispatch("tool", "w", { c: "Berlin" }, async () => 0); // miss
  const result = expectCassetteFullyUsed(harness.cassetteState());
  expect(result.pass).toBe(false);
  expect(result.message()).toMatch(/miss/i);
  expect(result.message()).toMatch(/unused/i);
});

test("cassetteExpectedCalls feeds expectExactTrajectory", async () => {
  const path = cassetteFile("order.json", [{ name: "w", input: { c: "P" }, output: 1 }]);
  const harness = createHarness({ cassette: path });
  await harness.dispatch("tool", "w", { c: "P" }, async () => 0);
  const result = expectExactTrajectory(harness.trajectory, cassetteExpectedCalls(harness));
  expect(result.pass).toBe(true);
});
