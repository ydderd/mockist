import type { Resolver, SequenceStubState, Stub } from "./types";
import { deepEqual } from "./deep-equal";

/** Identity helper for authoring a typed stub list. */
export function defineStubs(stubs: Stub[]): Stub[] {
  return stubs;
}

export type ResettableResolver = Resolver & {
  reset: () => void;
  /** Consumption/exhaustion state of every sequence stub this resolver owns. */
  sequenceState: () => SequenceStubState[];
};

/** First stub matching name + (predicate | args | name-only) wins; returns a produce thunk. */
export function predicateResolver(stubs: Stub[]): ResettableResolver {
  let cursors = new WeakMap<Stub, number>();
  // count of matching calls that arrived after every step was already consumed.
  let drained = new WeakMap<Stub, number>();

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
        return resolveSequenceStep(stub, input, cursors, drained);
      }

      if (!("result" in stub)) {
        // Defer the throw to produce() so the failing call is recorded in the
        // trajectory as a stubbed failure, like every other stub error.
        return {
          produce: () => {
            throw new Error(`mockist: stub "${name}" must define result or sequence`);
          },
        };
      }

      return {
        produce: () => produceResult(stub.result, input),
      };
    }
    return undefined;
  };

  resolve.reset = () => {
    cursors = new WeakMap<Stub, number>();
    drained = new WeakMap<Stub, number>();
  };

  resolve.sequenceState = () =>
    stubs
      .filter((stub): stub is Stub & { sequence: NonNullable<Stub["sequence"]> } => Boolean(stub.sequence))
      .map((stub) => {
        const length = stub.sequence.length;
        const cursor = cursors.get(stub) ?? 0;
        return {
          name: stub.name,
          kind: stub.kind ?? "tool",
          length,
          consumed: Math.min(cursor, length),
          exhausted: (drained.get(stub) ?? 0) > 0,
        };
      });

  return resolve;
}

function resolveSequenceStep(
  stub: Stub,
  input: unknown,
  cursors: WeakMap<Stub, number>,
  drained: WeakMap<Stub, number>,
) {
  const sequence = stub.sequence ?? [];
  if (sequence.length === 0) {
    // Defer the throw to produce() so the failing call is recorded (see above).
    return {
      produce: () => {
        throw new Error(`mockist: sequence stub "${stub.name}" must include at least one step`);
      },
    };
  }

  const cursor = cursors.get(stub) ?? 0;
  if (cursor >= sequence.length && (stub.onSequenceExhausted ?? "error") === "passthrough") {
    // Matched, but the sequence is spent: signal the harness to defer to the real
    // tool regardless of its onUnhandled policy. (Distinct from a non-match.)
    drained.set(stub, (drained.get(stub) ?? 0) + 1);
    return { passthrough: true, produce: passthroughProduced };
  }

  return {
    produce: () => {
      const cur = cursors.get(stub) ?? 0;
      if (cur >= sequence.length) {
        drained.set(stub, (drained.get(stub) ?? 0) + 1);
        // "passthrough" is handled at resolve time above and never reaches here.
        if ((stub.onSequenceExhausted ?? "error") === "repeat-last") {
          const last = sequence[sequence.length - 1]!;
          if ("error" in last) throw last.error;
          return produceResult(last.result, input);
        }
        throw new Error(`mockist: sequence stub "${stub.name}" exhausted after ${sequence.length} calls`);
      }

      const step = sequence[cur]!;
      cursors.set(stub, cur + 1);
      if ("error" in step) throw step.error;
      return produceResult(step.result, input);
    },
  };
}

/** Guard for a passthrough resolution's `produce` — the harness defers to `original` instead. */
function passthroughProduced(): never {
  throw new Error("mockist: passthrough resolution should defer to the real tool, not produce");
}

function produceResult(result: unknown, input: unknown): unknown | Promise<unknown> {
  return typeof result === "function"
    ? (result as (input: unknown) => unknown)(input)
    : result;
}
