import { expect, test } from "vitest";
import { inputMatches } from "../src/core/cassette/match";
import type { RecordedEntry } from "../src/core/types";

const entry = (e: Partial<RecordedEntry>): RecordedEntry => ({ name: "t", ...e });

test("default: exact deep-equal of input", () => {
  expect(inputMatches(entry({ input: { q: "x" } }), { q: "x" })).toBe(true);
  expect(inputMatches(entry({ input: { q: "x" } }), { q: "y" })).toBe(false);
});

test('match "name": any input matches', () => {
  expect(inputMatches(entry({ input: { q: "x" }, match: "name" }), { q: "y" })).toBe(true);
  expect(inputMatches(entry({ match: "name" }), { anything: 1 })).toBe(true);
});

test("match.ignore drops listed paths from comparison", () => {
  const e = entry({ input: { q: "x", requestId: "abc" }, match: { ignore: ["input.requestId"] } });
  expect(inputMatches(e, { q: "x", requestId: "zzz" })).toBe(true);
  expect(inputMatches(e, { q: "DIFF", requestId: "zzz" })).toBe(false);
});

test("redaction sentinels auto-wildcard their own paths", () => {
  const e = entry({ input: { q: "x", headers: { authorization: "[REDACTED:authorization]" } } });
  expect(inputMatches(e, { q: "x", headers: { authorization: "Bearer real-token" } })).toBe(true);
});
