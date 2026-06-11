import { expect, test } from "vitest";
import type { Call } from "../src/core/types";
import type { SequenceStubState } from "../src/core/types";
import {
  expectExactTrajectory,
  expectSubsequence,
  expectCalledTool,
  expectCalledWith,
  expectNoUnhandledCalls,
  expectNoPassthroughCalls,
  expectNoExhaustedSequences,
} from "../src/core/assert";

/** Build a Call with sensible defaults; only the interesting fields need to be set. */
function call(partial: Partial<Call> & { name: string }): Call {
  return {
    kind: "tool",
    input: {},
    stubbed: true,
    ts: 0,
    key: `${partial.kind ?? "tool"}:${partial.name}`,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// expectExactTrajectory
// ---------------------------------------------------------------------------

test("exact trajectory passes when order, length, and fields all match", () => {
  const traj = [
    call({ name: "get_weather", input: { city: "Paris" }, output: { tempC: 21 }, stubbed: true }),
    call({ name: "search", input: { q: "docs" }, output: { hits: [] }, stubbed: true }),
  ];
  const result = expectExactTrajectory(traj, [
    { name: "get_weather", input: { city: "Paris" }, stubbed: true },
    { name: "search", input: { q: "docs" } },
  ]);
  expect(result.pass).toBe(true);
});

test("exact trajectory fails on a length mismatch and shows both sides", () => {
  const traj = [
    call({ name: "get_weather", input: { city: "Paris" }, output: { tempC: 21 } }),
    call({ name: "extra", input: {}, output: 1, stubbed: false }),
  ];
  const result = expectExactTrajectory(traj, [{ name: "get_weather", input: { city: "Paris" } }]);
  expect(result.pass).toBe(false);
  const msg = result.message();
  expect(msg).toContain("1 call");
  expect(msg).toContain("2");
  expect(msg).toContain("Expected trajectory");
  expect(msg).toContain("Actual trajectory");
  expect(msg).toContain("get_weather");
  expect(msg).toContain("extra");
});

test("exact trajectory fails on a field mismatch and reports the index", () => {
  const traj = [
    call({ name: "get_weather", input: { city: "Paris" }, output: { tempC: 21 } }),
    call({ name: "search", input: { q: "billing" }, output: { hits: [] } }),
  ];
  const result = expectExactTrajectory(traj, [
    { name: "get_weather", input: { city: "Paris" } },
    { name: "search", input: { q: "docs" } },
  ]);
  expect(result.pass).toBe(false);
  const msg = result.message();
  expect(msg).toContain("index 1");
  expect(msg).toContain("billing"); // actual input
  expect(msg).toContain("docs"); // expected input
});

test("exact trajectory matches stubbed status and renders it", () => {
  const traj = [call({ name: "w", input: {}, output: 1, stubbed: false })];
  const result = expectExactTrajectory(traj, [{ name: "w", stubbed: true }]);
  expect(result.pass).toBe(false);
  const msg = result.message();
  expect(msg).toContain("passthrough"); // actual stubbed=false renders as passthrough
  expect(msg).toContain("stubbed"); // expected stubbed=true renders as stubbed
});

test("exact trajectory renders error outcomes", () => {
  const traj = [call({ name: "flaky", input: {}, error: new Error("503"), stubbed: true })];
  const result = expectExactTrajectory(traj, [{ name: "other" }]);
  const msg = result.message();
  expect(msg).toContain("error=");
  expect(msg).toContain("503");
});

test("exact trajectory matches error message and fails when it differs", () => {
  const traj = [call({ name: "flaky", input: {}, error: new Error("503"), stubbed: true })];
  expect(
    expectExactTrajectory(traj, [{ name: "flaky", error: new Error("503") }]).pass,
  ).toBe(true);
  const mismatch = expectExactTrajectory(traj, [{ name: "flaky", error: new Error("404") }]);
  expect(mismatch.pass).toBe(false);
  expect(mismatch.message()).toContain("503");
  expect(mismatch.message()).toContain("404");
});

test("subsequence matches error message and fails when it differs", () => {
  const traj = [call({ name: "flaky", input: {}, error: new Error("503"), stubbed: true })];
  expect(
    expectSubsequence(traj, [{ name: "flaky", error: new Error("503") }]).pass,
  ).toBe(true);
  const mismatch = expectSubsequence(traj, [{ name: "flaky", error: new Error("404") }]);
  expect(mismatch.pass).toBe(false);
});

// ---------------------------------------------------------------------------
// expectSubsequence
// ---------------------------------------------------------------------------

test("subsequence passes when expected calls appear in order with gaps", () => {
  const traj = [
    call({ name: "a", input: {} }),
    call({ name: "b", input: { x: 1 } }),
    call({ name: "c", input: {} }),
  ];
  const result = expectSubsequence(traj, [{ name: "a" }, { name: "c" }]);
  expect(result.pass).toBe(true);
});

test("subsequence fails when an expected call is missing or out of order", () => {
  const traj = [call({ name: "a", input: {} }), call({ name: "b", input: {} })];
  const result = expectSubsequence(traj, [{ name: "b" }, { name: "a" }]);
  expect(result.pass).toBe(false);
  const msg = result.message();
  expect(msg).toContain("subsequence");
  expect(msg).toContain("Actual trajectory");
  expect(msg).toContain("a");
});

test("subsequence matches on partial-equal input fields", () => {
  const traj = [call({ name: "search", input: { q: "docs", page: 2 } })];
  const pass = expectSubsequence(traj, [{ name: "search", input: { q: "docs", page: 2 } }]);
  expect(pass.pass).toBe(true);
});

// ---------------------------------------------------------------------------
// expectCalledTool
// ---------------------------------------------------------------------------

test("calledTool passes when the tool was called", () => {
  const traj = [call({ name: "search" })];
  expect(expectCalledTool(traj, "search").pass).toBe(true);
});

test("calledTool fails and lists the tools that were called", () => {
  const traj = [call({ name: "get_weather" }), call({ name: "now" })];
  const result = expectCalledTool(traj, "search");
  expect(result.pass).toBe(false);
  const msg = result.message();
  expect(msg).toContain("search");
  expect(msg).toContain("get_weather");
  expect(msg).toContain("now");
});

// ---------------------------------------------------------------------------
// expectCalledWith (deep-subset)
// ---------------------------------------------------------------------------

test("calledWith passes on a deep-subset match (extra fields ignored)", () => {
  const traj = [call({ name: "search", input: { q: "docs", page: 2, filters: { lang: "en" } } })];
  const result = expectCalledWith(traj, "search", { q: "docs", filters: { lang: "en" } });
  expect(result.pass).toBe(true);
});

test("calledWith fails when no call to that tool matches the partial input", () => {
  const traj = [call({ name: "search", input: { q: "billing" } })];
  const result = expectCalledWith(traj, "search", { q: "docs" });
  expect(result.pass).toBe(false);
  const msg = result.message();
  expect(msg).toContain("search");
  expect(msg).toContain("docs"); // expected partial
  expect(msg).toContain("billing"); // the actual call shown
});

test("calledWith fails clearly when the tool was never called", () => {
  const traj = [call({ name: "other" })];
  const result = expectCalledWith(traj, "search", { q: "docs" });
  expect(result.pass).toBe(false);
  expect(result.message()).toContain("never called");
});

// ---------------------------------------------------------------------------
// expectNoUnhandledCalls / expectNoPassthroughCalls
// ---------------------------------------------------------------------------

test("noUnhandledCalls passes when every call was stubbed", () => {
  const traj = [call({ name: "a", stubbed: true }), call({ name: "b", stubbed: true })];
  expect(expectNoUnhandledCalls(traj).pass).toBe(true);
});

test("noUnhandledCalls fails and shows the offending un-stubbed calls", () => {
  const traj = [
    call({ name: "a", stubbed: true }),
    call({ name: "leak", input: { id: 7 }, output: 1, stubbed: false }),
  ];
  const result = expectNoUnhandledCalls(traj);
  expect(result.pass).toBe(false);
  const msg = result.message();
  expect(msg).toContain("unhandled");
  expect(msg).toContain("leak");
  expect(msg).toContain("passthrough");
});

test("noPassthroughCalls passes when everything was stubbed", () => {
  const traj = [call({ name: "a", stubbed: true })];
  expect(expectNoPassthroughCalls(traj).pass).toBe(true);
});

test("noPassthroughCalls fails and names the passed-through call", () => {
  const traj = [call({ name: "leak", stubbed: false, output: 1 })];
  const result = expectNoPassthroughCalls(traj);
  expect(result.pass).toBe(false);
  expect(result.message()).toContain("leak");
});

// ---------------------------------------------------------------------------
// expectNoExhaustedSequences
// ---------------------------------------------------------------------------

test("noExhaustedSequences passes when no sequence ran dry", () => {
  const states: SequenceStubState[] = [
    { name: "flaky", kind: "tool", length: 2, consumed: 2, exhausted: false },
  ];
  expect(expectNoExhaustedSequences(states).pass).toBe(true);
});

test("noExhaustedSequences fails and reports which sequence ran dry", () => {
  const states: SequenceStubState[] = [
    { name: "flaky", kind: "tool", length: 2, consumed: 2, exhausted: true },
    { name: "ok", kind: "tool", length: 1, consumed: 1, exhausted: false },
  ];
  const result = expectNoExhaustedSequences(states);
  expect(result.pass).toBe(false);
  const msg = result.message();
  expect(msg).toContain("flaky");
  expect(msg).toContain("2"); // steps / length
  expect(msg).not.toContain('"ok"'); // non-exhausted sequence not named
});
