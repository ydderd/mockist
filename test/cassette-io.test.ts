import { afterAll, expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCassetteEntries, writeCassette } from "../src/core/cassette/io";
import { CASSETTE_FORMAT_VERSION } from "../src/core/cassette/format";
import type { Call } from "../src/core/types";

const dir = mkdtempSync(join(tmpdir(), "mockist-io-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("missing cassette warns once and returns empty", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const path = join(dir, "nope.json");
  expect(loadCassetteEntries(path)).toEqual([]);
  expect(loadCassetteEntries(path)).toEqual([]);
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

test("writeCassette creates dirs and round-trips through loadCassetteEntries", async () => {
  const path = join(dir, "nested", "flow.json");
  const calls: Call[] = [
    { kind: "tool", name: "s", input: { q: "x" }, output: 1, stubbed: true, ts: 0, key: "k" },
  ];
  await writeCassette(path, calls, { now: "2026-06-13T00:00:00Z" });
  const text = readFileSync(path, "utf8");
  expect(JSON.parse(text).mockist_format_version).toBe(CASSETTE_FORMAT_VERSION);
  const entries = loadCassetteEntries(path);
  expect(entries[0]).toMatchObject({ name: "s", output: 1 });
});
