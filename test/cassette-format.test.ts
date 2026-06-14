import { expect, test } from "vitest";
import { parseCassette, serializeCassette, CASSETTE_FORMAT_VERSION } from "../src/core/cassette/format";
import type { Call } from "../src/core/types";

const call = (over: Partial<Call>): Call => ({
  kind: "tool", name: "t", input: {}, stubbed: true, ts: 0, key: "k", ...over,
});

test("parseCassette returns ordered entries for a valid file", () => {
  const text = JSON.stringify({
    mockist_format_version: CASSETTE_FORMAT_VERSION,
    calls: [{ name: "search", input: { q: "x" }, output: { hits: [] } }],
  });
  const entries = parseCassette(text, "x.json");
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ name: "search", output: { hits: [] } });
});

test("parseCassette throws on malformed JSON, bad version, and bad entry", () => {
  expect(() => parseCassette("{not json", "x.json")).toThrow(/x\.json/);
  expect(() => parseCassette(JSON.stringify({ mockist_format_version: 999, calls: [] }), "x.json")).toThrow(/version/);
  const both = JSON.stringify({
    mockist_format_version: CASSETTE_FORMAT_VERSION,
    calls: [{ name: "t", output: 1, error: { name: "Error", message: "e" } }],
  });
  expect(() => parseCassette(both, "x.json")).toThrow(/exactly one of/);
  const nullError = JSON.stringify({
    mockist_format_version: CASSETTE_FORMAT_VERSION,
    calls: [{ name: "t", error: null }],
  });
  expect(() => parseCassette(nullError, "x.json")).toThrow(/exactly one of/);
  const badMatch = JSON.stringify({
    mockist_format_version: CASSETTE_FORMAT_VERSION,
    calls: [{ name: "t", output: 1, match: {} }],
  });
  expect(() => parseCassette(badMatch, "x.json")).toThrow(/invalid "match"/);
});

test("serializeCassette emits sorted-key JSON, a manifest, and maps errors", () => {
  const text = serializeCassette(
    [
      call({ name: "a", input: { token: "[REDACTED:token]" }, output: { ok: true } }),
      call({ name: "b", input: { q: 1 }, error: new Error("boom") }),
    ],
    { now: "2026-06-13T00:00:00Z" },
  );
  const parsed = JSON.parse(text);
  expect(parsed.mockist_format_version).toBe(CASSETTE_FORMAT_VERSION);
  expect(parsed.recordedAt).toBe("2026-06-13T00:00:00Z");
  expect(parsed.redactions).toEqual(["calls[0].input.token"]);
  expect(parsed.calls[1].error).toEqual({ name: "Error", message: "boom" });
  // sorted keys: top-level keys are alphabetized
  expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
});

test("serializeCassette throws on non-serializable output", () => {
  expect(() => serializeCassette([call({ output: () => 1 })], { now: "t" })).toThrow(/serializ/i);
});

test("serializeCassette throws on circular references", () => {
  const input: Record<string, unknown> = { a: 1 };
  input.self = input;
  expect(() => serializeCassette([call({ input })], { now: "t" })).toThrow(/circular reference/i);
});
