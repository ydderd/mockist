import { afterAll, afterEach, expect, test, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
