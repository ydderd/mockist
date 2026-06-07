export type CallKind = "tool" | "skill" | "subagent";

/** A normalized record of one call. Shared by the recorder; reusable as a fixture later. */
export interface Call {
  kind: CallKind;
  name: string;
  input: unknown;
  output?: unknown;
  error?: unknown;
  /** true if a resolver supplied the result; false if the real `original` ran. */
  stubbed: boolean;
  ts: number;
  /** stable identity from `identify()`. */
  key: string;
}

/** A stub's result: a literal value, or a function of the input. May be async. May throw. */
export type StubResult =
  | unknown
  | ((input: any) => unknown | Promise<unknown>);

/** A declarative stub. Matches on name + (predicate | args | name-only). */
export interface Stub {
  /** defaults to "tool". */
  kind?: CallKind;
  name: string;
  /** exact-args match: deep-equals the call input. */
  args?: unknown;
  /** predicate match; takes precedence over `args` when present. */
  match?: (input: any) => boolean;
  result: StubResult;
}

/**
 * A resolver returns a Resolution on a hit, or undefined to defer to the next resolver.
 * `produce` is a thunk so its invocation (and any throw from a result function) happens
 * inside the harness — letting a throwing stub be recorded as a failure, not crash matching.
 */
export interface Resolution {
  produce: () => unknown | Promise<unknown>;
}
export type ResolverInput = Pick<Call, "kind" | "name" | "input">;
export type Resolver = (call: ResolverInput) => Resolution | undefined;

/** What to do when no resolver matches a call. */
export type UnhandledPolicy = "passthrough" | "warn" | "error";
