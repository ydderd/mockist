import { expect } from "@jest/globals";
import type { Harness } from "../core/harness";
import { matcherContext } from "./shared";

declare module "@jest/expect" {
  interface Matchers<R> {
    toHaveCalledTool(name: string): R;
    toHaveCalledWith(name: string, partialInput: unknown): R;
    toHaveToolTrajectory(expected: import("../core/assert").ExpectedCall[]): R;
    toHaveToolSubsequence(expected: import("../core/assert").ExpectedCall[]): R;
    toHaveNoUnhandledToolCalls(): R;
    toHaveNoPassthroughToolCalls(): R;
    toHaveNoExhaustedStubSequences(): R;
    toHaveFullyUsedCassette(): R;
  }
}

let activeHarness: Harness | undefined;

export function useMockistHarness(harness: Harness): void {
  activeHarness = harness;
}

expect.extend({
  toHaveCalledTool(received: unknown, name: string) {
    const result = matcherContext(received, activeHarness).toHaveCalledTool(name);
    return { pass: result.pass, message: result.message };
  },
  toHaveCalledWith(received: unknown, name: string, partialInput: unknown) {
    const result = matcherContext(received, activeHarness).toHaveCalledWith(name, partialInput);
    return { pass: result.pass, message: result.message };
  },
  toHaveToolTrajectory(received: unknown, expected: import("../core/assert").ExpectedCall[]) {
    const result = matcherContext(received, activeHarness).toHaveToolTrajectory(expected);
    return { pass: result.pass, message: result.message };
  },
  toHaveToolSubsequence(received: unknown, expected: import("../core/assert").ExpectedCall[]) {
    const result = matcherContext(received, activeHarness).toHaveToolSubsequence(expected);
    return { pass: result.pass, message: result.message };
  },
  toHaveNoUnhandledToolCalls(received: unknown) {
    const result = matcherContext(received, activeHarness).toHaveNoUnhandledToolCalls();
    return { pass: result.pass, message: result.message };
  },
  toHaveNoPassthroughToolCalls(received: unknown) {
    const result = matcherContext(received, activeHarness).toHaveNoPassthroughToolCalls();
    return { pass: result.pass, message: result.message };
  },
  toHaveNoExhaustedStubSequences(received: unknown) {
    const result = matcherContext(received, activeHarness).toHaveNoExhaustedStubSequences();
    return { pass: result.pass, message: result.message };
  },
  toHaveFullyUsedCassette(received: unknown) {
    const result = matcherContext(received, activeHarness).toHaveFullyUsedCassette();
    return { pass: result.pass, message: result.message };
  },
});

export { mockistMatchers } from "./shared";
