import type { Resolver, Stub } from "./types";
import { deepEqual } from "./deep-equal";

/** Identity helper for authoring a typed stub list. */
export function defineStubs(stubs: Stub[]): Stub[] {
  return stubs;
}

export type ResettableResolver = Resolver & { reset: () => void };

/** First stub matching name + (predicate | args | name-only) wins; returns a produce thunk. */
export function predicateResolver(stubs: Stub[]): ResettableResolver {
  let cursors = new WeakMap<Stub, number>();

  const resolve: ResettableResolver = ({ kind, name, input }) => {
    for (const stub of stubs) {
      const stubKind = stub.kind ?? "tool";
      if (stubKind !== kind || stub.name !== name) continue;

      const matches = stub.match
        ? stub.match(input)
        : stub.args !== undefined
          ? deepEqual(input, stub.args)
          : true;
      if (!matches) continue;

      if (stub.sequence) {
        return resolveSequenceStep(stub, input, cursors);
      }

      if (!("result" in stub)) {
        throw new Error(`mockist: stub "${name}" must define result or sequence`);
      }

      return {
        produce: () => produceResult(stub.result, input),
      };
    }
    return undefined;
  };

  resolve.reset = () => {
    cursors = new WeakMap<Stub, number>();
  };

  return resolve;
}

function resolveSequenceStep(
  stub: Stub,
  input: unknown,
  cursors: WeakMap<Stub, number>,
) {
  const sequence = stub.sequence ?? [];
  if (sequence.length === 0) {
    throw new Error(`mockist: sequence stub "${stub.name}" must include at least one step`);
  }

  const cursor = cursors.get(stub) ?? 0;
  if (cursor >= sequence.length && (stub.onSequenceExhausted ?? "error") === "passthrough") {
    return undefined;
  }

  return {
    produce: () => {
      const cur = cursors.get(stub) ?? 0;
      if (cur >= sequence.length) {
        const exhausted = stub.onSequenceExhausted ?? "error";
        if (exhausted === "error") {
          throw new Error(`mockist: sequence stub "${stub.name}" exhausted after ${sequence.length} calls`);
        }
        const step = sequence[sequence.length - 1]!;
        cursors.set(stub, cur + 1);
        if ("error" in step) throw step.error;
        return produceResult(step.result, input);
      }

      const step = sequence[cur]!;
      cursors.set(stub, cur + 1);
      if ("error" in step) throw step.error;
      return produceResult(step.result, input);
    },
  };
}

function produceResult(result: unknown, input: unknown): unknown | Promise<unknown> {
  return typeof result === "function"
    ? (result as (input: unknown) => unknown)(input)
    : result;
}
