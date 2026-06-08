import type { Resolver, Stub } from "./types";
import { deepEqual } from "./deep-equal";

/** Identity helper for authoring a typed stub list. */
export function defineStubs(stubs: Stub[]): Stub[] {
  return stubs;
}

/** First stub matching name + (predicate | args | name-only) wins; returns a produce thunk. */
export function predicateResolver(stubs: Stub[]): Resolver {
  return ({ kind, name, input }) => {
    for (const stub of stubs) {
      const stubKind = stub.kind ?? "tool";
      if (stubKind !== kind || stub.name !== name) continue;

      const matches = stub.match
        ? stub.match(input)
        : stub.args !== undefined
          ? deepEqual(input, stub.args)
          : true;
      if (!matches) continue;

      return {
        produce: () =>
          typeof stub.result === "function"
            ? (stub.result as (input: unknown) => unknown)(input)
            : stub.result,
      };
    }
    return undefined;
  };
}
