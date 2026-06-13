import type { Call, CallKind, CassetteState, RecordedEntry, ResolverInput, SequenceStubState } from "./types";
import { deepEqual } from "./deep-equal";
import type { Harness } from "./harness";

/**
 * Result of a trajectory assertion. Runner-agnostic by design: it never throws and
 * never imports a test framework. `message()` renders a readable expected-vs-actual
 * diff, computed lazily so the passing path stays cheap. A Vitest/Jest matcher (M3)
 * wraps this shape directly.
 */
export interface AssertionResult {
  pass: boolean;
  message: () => string;
}

/** A partial call spec to match against a recorded {@link Call}. Only `name` is required. */
export interface ExpectedCall {
  name: string;
  kind?: CallKind;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  stubbed?: boolean;
}

type Trajectory = readonly Call[];

// --- rendering --------------------------------------------------------------

function formatValue(value: unknown): string {
  if (value instanceof Error) return `Error(${JSON.stringify(value.message)})`;
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function describeCall(call: Call, index: number): string {
  const parts = [`${call.kind} ${call.name}`, `input=${formatValue(call.input)}`];
  if (call.error !== undefined) parts.push(`error=${formatValue(call.error)}`);
  else parts.push(`output=${formatValue(call.output)}`);
  parts.push(call.stubbed ? "stubbed" : "passthrough");
  return `  [${index}] ${parts.join(" ")}`;
}

function describeExpected(expected: ExpectedCall, index: number): string {
  const parts = [`${expected.kind ?? "tool"} ${expected.name}`];
  if (expected.input !== undefined) parts.push(`input=${formatValue(expected.input)}`);
  if (expected.error !== undefined) parts.push(`error=${formatValue(expected.error)}`);
  if (expected.output !== undefined) parts.push(`output=${formatValue(expected.output)}`);
  if (expected.stubbed !== undefined) parts.push(expected.stubbed ? "stubbed" : "passthrough");
  return `  [${index}] ${parts.join(" ")}`;
}

function renderTrajectory(trajectory: Trajectory): string {
  if (trajectory.length === 0) return "Actual trajectory: (no calls recorded)";
  return ["Actual trajectory:", ...trajectory.map(describeCall)].join("\n");
}

function renderExpected(expected: ExpectedCall[]): string {
  if (expected.length === 0) return "Expected trajectory: (no calls)";
  return ["Expected trajectory:", ...expected.map(describeExpected)].join("\n");
}

function diffBlock(expected: ExpectedCall[], trajectory: Trajectory, reason: string): string {
  return [reason, renderExpected(expected), renderTrajectory(trajectory)].join("\n");
}

// --- matching ---------------------------------------------------------------

/** Deep-subset: every key/element of `subset` matches `actual`; extra `actual` keys are ignored. */
function deepSubset(subset: unknown, actual: unknown): boolean {
  if (subset === null || typeof subset !== "object") return deepEqual(subset, actual);
  if (actual === null || typeof actual !== "object") return false;
  if (Array.isArray(subset) || Array.isArray(actual)) {
    if (!Array.isArray(subset) || !Array.isArray(actual)) return false;
    if (subset.length !== actual.length) return false;
    return subset.every((s, i) => deepSubset(s, actual[i]));
  }
  const sub = subset as Record<string, unknown>;
  const act = actual as Record<string, unknown>;
  return Object.keys(sub).every((k) => k in act && deepSubset(sub[k], act[k]));
}

/** A recorded call matches an expected spec when every *specified* field deep-equals. */
function callMatches(call: Call, expected: ExpectedCall): boolean {
  if (call.name !== expected.name) return false;
  if (expected.kind !== undefined && call.kind !== expected.kind) return false;
  if (expected.input !== undefined && !deepEqual(call.input, expected.input)) return false;
  if (expected.output !== undefined && !deepEqual(call.output, expected.output)) return false;
  if (expected.error !== undefined && !deepEqual(call.error, expected.error)) return false;
  if (expected.stubbed !== undefined && call.stubbed !== expected.stubbed) return false;
  return true;
}

// --- assertions -------------------------------------------------------------

/** The full trajectory, in order: same length and every position matches its spec. */
export function expectExactTrajectory(
  trajectory: Trajectory,
  expected: ExpectedCall[],
): AssertionResult {
  if (trajectory.length !== expected.length) {
    return {
      pass: false,
      message: () =>
        diffBlock(
          expected,
          trajectory,
          `Expected an exact trajectory of ${expected.length} call(s), but recorded ${trajectory.length}.`,
        ),
    };
  }
  const mismatch = expected.findIndex((spec, i) => !callMatches(trajectory[i]!, spec));
  if (mismatch !== -1) {
    return {
      pass: false,
      message: () => diffBlock(expected, trajectory, `Trajectory mismatch at index ${mismatch}.`),
    };
  }
  return { pass: true, message: () => `Trajectory matched ${expected.length} call(s).` };
}

/** Expected calls appear in order, gaps allowed (an ordered subsequence of the trajectory). */
export function expectSubsequence(
  trajectory: Trajectory,
  expected: ExpectedCall[],
): AssertionResult {
  let cursor = 0;
  for (const spec of expected) {
    while (cursor < trajectory.length && !callMatches(trajectory[cursor]!, spec)) cursor++;
    if (cursor >= trajectory.length) {
      return {
        pass: false,
        message: () =>
          diffBlock(
            expected,
            trajectory,
            `Expected calls as an ordered subsequence, but "${spec.name}" was not found in order.`,
          ),
      };
    }
    cursor++;
  }
  return { pass: true, message: () => `Found ${expected.length} call(s) as an ordered subsequence.` };
}

/** At least one call was made to `name`. */
export function expectCalledTool(trajectory: Trajectory, name: string): AssertionResult {
  const found = trajectory.some((c) => c.name === name);
  return {
    pass: found,
    message: () => {
      if (found) return `Found call(s) to "${name}".`;
      const names = trajectory.map((c) => c.name);
      const list = names.length ? names.join(", ") : "(none)";
      return `Expected a call to tool "${name}", but it was never called. Calls recorded: ${list}.`;
    },
  };
}

/** At least one call to `name` whose input is a deep-superset of `partialInput`. */
export function expectCalledWith(
  trajectory: Trajectory,
  name: string,
  partialInput: unknown,
): AssertionResult {
  const toName = trajectory.filter((c) => c.name === name);
  const found = toName.some((c) => deepSubset(partialInput, c.input));
  return {
    pass: found,
    message: () => {
      if (found) return `Found a call to "${name}" matching ${formatValue(partialInput)}.`;
      if (toName.length === 0) {
        return `Expected a call to "${name}" with input matching ${formatValue(partialInput)}, but "${name}" was never called.`;
      }
      const seen = toName.map((c, i) => describeCall(c, i)).join("\n");
      return [
        `Expected a call to "${name}" with input matching ${formatValue(partialInput)}, but none matched.`,
        `Calls to "${name}":`,
        seen,
      ].join("\n");
    },
  };
}

function offendersBlock(label: string, offenders: Call[], reason: string): string {
  return [reason, label, ...offenders.map((c, i) => describeCall(c, i))].join("\n");
}

/** No call hit the onUnhandled policy — every call was resolved by a stub/resolver (`stubbed`). */
export function expectNoUnhandledCalls(trajectory: Trajectory): AssertionResult {
  const offenders = trajectory.filter((c) => !c.stubbed);
  return {
    pass: offenders.length === 0,
    message: () =>
      offendersBlock(
        "Unhandled calls:",
        offenders,
        `Expected no unhandled (passthrough/error) calls, but ${offenders.length} call(s) were not stubbed:`,
      ),
  };
}

/** Everything was stubbed — nothing ran the real tool (a passthrough). Alias view of "no unhandled". */
export function expectNoPassthroughCalls(trajectory: Trajectory): AssertionResult {
  const offenders = trajectory.filter((c) => !c.stubbed);
  return {
    pass: offenders.length === 0,
    message: () =>
      offendersBlock(
        "Passed-through calls:",
        offenders,
        `Expected every call to be stubbed, but ${offenders.length} call(s) passed through to the real tool:`,
      ),
  };
}

/** No sequence stub ran dry (a matching call arrived after all steps were consumed). */
export function expectNoExhaustedSequences(
  states: readonly SequenceStubState[],
): AssertionResult {
  const exhausted = states.filter((s) => s.exhausted);
  return {
    pass: exhausted.length === 0,
    message: () => {
      const lines = exhausted.map(
        (s) => `  ${s.kind} "${s.name}" (${s.length} step(s), all consumed then called again)`,
      );
      return [
        `Expected no exhausted sequences, but ${exhausted.length} ran dry:`,
        ...lines,
      ].join("\n");
    },
  };
}

function describeInput(call: ResolverInput, index: number): string {
  return `  [${index}] ${call.kind} ${call.name} input=${formatValue(call.input)}`;
}

function describeEntry(entry: RecordedEntry, index: number): string {
  const kind = entry.kind ?? "tool";
  const body = entry.error !== undefined ? `error=${formatValue(entry.error)}` : `output=${formatValue(entry.output)}`;
  return `  [${index}] ${kind} ${entry.name} input=${formatValue(entry.input)} ${body}`;
}

/** Every recorded entry was consumed and no call missed the cassette. */
export function expectCassetteFullyUsed(state: CassetteState): AssertionResult {
  const pass = state.missed.length === 0 && state.unused.length === 0;
  return {
    pass,
    message: () => {
      if (pass) return `Cassette "${state.path}" fully used: every entry consumed, no misses.`;
      const lines = [`Cassette "${state.path}" not fully used.`];
      if (state.missed.length) {
        lines.push(`Missed entries — calls that matched no cassette entry (${state.missed.length}):`, ...state.missed.map(describeInput));
      }
      if (state.unused.length) {
        lines.push(`Unused entries — recorded entries never called (${state.unused.length}):`, ...state.unused.map(describeEntry));
      }
      return lines.join("\n");
    },
  };
}

/**
 * Derive an ordered ExpectedCall[] from a harness's loaded cassette entries, for asserting
 * call ORDER via expectExactTrajectory/expectSubsequence. Asserts name + kind only — input is
 * intentionally omitted, because cassette entries may match loosely (`match`/redaction
 * wildcards) and the exact-trajectory matcher deep-equals input, which would false-negative on
 * an ignored or redacted field. Input is already validated by cassette matching at replay;
 * use expectCalledWith for explicit input assertions.
 */
export function cassetteExpectedCalls(harness: Harness): ExpectedCall[] {
  return harness.cassetteState().entries.map((entry) => {
    const spec: ExpectedCall = { name: entry.name };
    if (entry.kind !== undefined) spec.kind = entry.kind;
    return spec;
  });
}
