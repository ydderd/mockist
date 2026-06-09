export { createHarness, Harness, type HarnessOptions } from "./core/harness";
export { defineStubs, predicateResolver } from "./core/registry";
export { Recorder, type Redactor } from "./core/recorder";
export { identify, stableStringify } from "./core/identity";
export { deepEqual } from "./core/deep-equal";
export { wrapVercelTools } from "./adapters/vercel";
export type {
  Call,
  CallKind,
  Resolution,
  Resolver,
  ResolverInput,
  Stub,
  StubResult,
  UnhandledPolicy,
} from "./core/types";
