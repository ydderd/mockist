import { afterAll, afterEach, expect, test, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expectCassetteFullyUsed } from "../src/core/assert";
import { createHarness } from "../src/core/harness";

const dir = mkdtempSync(join(tmpdir(), "mockist-record-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => { delete process.env.MOCKIST_RECORD; });

test("record mode forces passthrough, redacts, and save() writes the cassette", async () => {
  process.env.MOCKIST_RECORD = "1";
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const path = join(dir, "rec.json");
  const harness = createHarness({ cassette: path, onUnhandled: "error" }); // error must be overridden

  const real = vi.fn(async () => ({ ok: true, token: "tok_live_secret" }));
  const out = await harness.dispatch("tool", "fetch", { authorization: "Bearer sk-9" }, real);

  expect(out).toEqual({ ok: true, token: "tok_live_secret" }); // real ran
  expect(real).toHaveBeenCalledTimes(1);

  await harness.save();
  expect(existsSync(path)).toBe(true);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  expect(parsed.calls[0].input.authorization).toBe("[REDACTED:authorization]");
  expect(parsed.calls[0].output.token).toBe("[REDACTED:token]");
  warn.mockRestore();
});

test("save() is a no-op in replay mode", async () => {
  const path = join(dir, "noop.json");
  const harness = createHarness({ cassette: path }); // MOCKIST_RECORD unset → replay
  await harness.save();
  expect(existsSync(path)).toBe(false);
});

test("save() is a no-op when no calls were recorded", async () => {
  process.env.MOCKIST_RECORD = "1";
  const path = join(dir, "empty.json");
  writeFileSync(path, JSON.stringify({ mockist_format_version: 1, calls: [{ name: "keep", output: 1 }] }));
  const harness = createHarness({ cassette: path });
  await harness.save();
  expect(JSON.parse(readFileSync(path, "utf8")).calls[0].name).toBe("keep");
});

test("recordCall handoff markers stay out of cassettes so replay can fully consume entries", async () => {
  process.env.MOCKIST_RECORD = "1";
  const path = join(dir, "handoff.json");
  const harness = createHarness({ cassette: path });
  await harness.dispatch("tool", "plan", {}, async () => ({ ok: true }));
  harness.recordCall("subagent", "researcher", { task: "find docs" });
  expect(harness.trajectory).toHaveLength(2);

  await harness.save();
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  expect(parsed.calls).toHaveLength(1);
  expect(parsed.calls[0].name).toBe("plan");

  delete process.env.MOCKIST_RECORD;
  const replay = createHarness({ cassette: path, onUnhandled: "error" });
  await replay.dispatch("tool", "plan", {}, async () => ({ ok: false }));
  replay.recordCall("subagent", "researcher", { task: "find docs" });
  expect(expectCassetteFullyUsed(replay.cassetteState()).pass).toBe(true);
});

test("flush after reset() still writes recorded calls (runner afterEach order)", async () => {
  process.env.MOCKIST_RECORD = "1";
  const path = join(dir, "after-reset.json");
  const harness = createHarness({ cassette: path });
  await harness.dispatch("tool", "fetch", { q: "x" }, async () => ({ ok: true }));
  harness.reset();
  await harness.save();
  expect(JSON.parse(readFileSync(path, "utf8")).calls).toHaveLength(1);
});
