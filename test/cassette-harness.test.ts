import { afterAll, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness } from "../src/core/harness";
import { CASSETTE_FORMAT_VERSION } from "../src/core/cassette/format";

const dir = mkdtempSync(join(tmpdir(), "mockist-harness-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function cassetteFile(name: string, calls: unknown[]): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify({ mockist_format_version: CASSETTE_FORMAT_VERSION, calls }));
  return path;
}

test("replay serves a recorded call and never runs original", async () => {
  const path = cassetteFile("a.json", [{ name: "w", input: { city: "Paris" }, output: { tempC: 21 } }]);
  const harness = createHarness({ cassette: path });
  const original = vi.fn(async () => ({ tempC: 99 }));
  const out = await harness.dispatch("tool", "w", { city: "Paris" }, original);
  expect(out).toEqual({ tempC: 21 });
  expect(original).not.toHaveBeenCalled();
  expect(harness.trajectory[0]).toMatchObject({ name: "w", stubbed: true });
});

test("an unmatched call falls through to onUnhandled (passthrough default)", async () => {
  const path = cassetteFile("b.json", [{ name: "w", input: { city: "Paris" }, output: 1 }]);
  const harness = createHarness({ cassette: path });
  const out = await harness.dispatch("tool", "w", { city: "Berlin" }, async () => "real");
  expect(out).toBe("real");
  const state = harness.cassetteState();
  expect(state.missed).toHaveLength(1);
  expect(state.unused).toHaveLength(1);
});

test("explicit stubs win over the cassette", async () => {
  const path = cassetteFile("c.json", [{ name: "w", input: {}, output: "from-cassette" }]);
  const harness = createHarness({ cassette: path, stubs: [{ name: "w", result: "from-stub" }] });
  expect(await harness.dispatch("tool", "w", {}, async () => "real")).toBe("from-stub");
});

test("missing cassette + onUnhandled error seals on first call", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const harness = createHarness({ cassette: join(dir, "missing.json"), onUnhandled: "error" });
  await expect(harness.dispatch("tool", "w", {}, async () => "real")).rejects.toThrow(/unhandled/);
  warn.mockRestore();
});

test("reset re-arms cassette consumption", async () => {
  const path = cassetteFile("d.json", [{ name: "w", input: {}, output: 1 }]);
  const harness = createHarness({ cassette: path });
  await harness.dispatch("tool", "w", {}, async () => 0);
  expect(harness.cassetteState().unused).toHaveLength(0);
  harness.reset();
  expect(harness.cassetteState().unused).toHaveLength(1);
});
