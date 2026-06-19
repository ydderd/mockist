import type { Harness } from "../core/harness";
import type { ExpectedCall } from "../core/assert";
import {
  expectCalledTool,
  expectCalledWith,
  expectCassetteFullyUsed,
  expectExactTrajectory,
  expectNoExhaustedSequences,
  expectNoPassthroughCalls,
  expectNoUnhandledCalls,
  expectSubsequence,
  type AssertionResult,
} from "../core/assert";

export interface MockistMatchers {
  toHaveCalledTool(name: string): AssertionResult;
  toHaveCalledWith(name: string, partialInput: unknown): AssertionResult;
  toHaveToolTrajectory(expected: ExpectedCall[]): AssertionResult;
  toHaveToolSubsequence(expected: ExpectedCall[]): AssertionResult;
  toHaveNoUnhandledToolCalls(): AssertionResult;
  toHaveNoPassthroughToolCalls(): AssertionResult;
  toHaveNoExhaustedStubSequences(): AssertionResult;
  toHaveFullyUsedCassette(): AssertionResult;
}

function wrap(result: AssertionResult) {
  return { pass: result.pass, message: result.message };
}

export function mockistMatchers(harness: Harness): MockistMatchers {
  return {
    toHaveCalledTool: (name) => wrap(expectCalledTool(harness.trajectory, name)),
    toHaveCalledWith: (name, partialInput) => wrap(expectCalledWith(harness.trajectory, name, partialInput)),
    toHaveToolTrajectory: (expected) => wrap(expectExactTrajectory(harness.trajectory, expected)),
    toHaveToolSubsequence: (expected) => wrap(expectSubsequence(harness.trajectory, expected)),
    toHaveNoUnhandledToolCalls: () => wrap(expectNoUnhandledCalls(harness.trajectory)),
    toHaveNoPassthroughToolCalls: () => wrap(expectNoPassthroughCalls(harness.trajectory)),
    toHaveNoExhaustedStubSequences: () => wrap(expectNoExhaustedSequences(harness.sequenceState())),
    toHaveFullyUsedCassette: () => wrap(expectCassetteFullyUsed(harness.cassetteState())),
  };
}

function resolveHarness(received: unknown, active?: Harness): Harness {
  if (received && typeof received === "object" && "trajectory" in received) {
    return received as Harness;
  }
  if (active) return active;
  throw new Error("mockist: pass a Harness to expect(harness) or call useMockistHarness(harness) first");
}

export function matcherContext(received: unknown, active?: Harness) {
  return mockistMatchers(resolveHarness(received, active));
}

export type { ExpectedCall, AssertionResult };
