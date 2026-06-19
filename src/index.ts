export { createHarness, Harness, type HarnessOptions } from "./core/harness";
export { defineStubs, predicateResolver } from "./core/registry";
export { Recorder, type Redactor } from "./core/recorder";
export { identify, stableStringify } from "./core/identity";
export { deepEqual } from "./core/deep-equal";
export { wrapVercelTools } from "./adapters/vercel";
export { concatTrajectories, mergeHarnessTrajectories } from "./core/composition";
export {
  expectExactTrajectory,
  expectSubsequence,
  expectCalledTool,
  expectCalledWith,
  expectNoUnhandledCalls,
  expectNoPassthroughCalls,
  expectNoExhaustedSequences,
  expectCassetteFullyUsed,
  cassetteExpectedCalls,
  type AssertionResult,
  type ExpectedCall,
} from "./core/assert";
export { defaultRedactor, isRedacted, redactionSentinel, SECRET_KEYS } from "./core/cassette/redact";
export { CASSETTE_FORMAT_VERSION } from "./core/cassette/format";
export { flushPendingSaves } from "./core/cassette/registry";
export type {
  Call,
  CallKind,
  CassetteState,
  MatchDirective,
  RecordedEntry,
  RecordedError,
  Resolution,
  Resolver,
  ResolverInput,
  SequenceStubState,
  Stub,
  StubResult,
  UnhandledPolicy,
} from "./core/types";
