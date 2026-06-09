import type { Call, CallKind, Resolver, Stub, UnhandledPolicy } from "./types";
import { predicateResolver } from "./registry";
import { Recorder, type Redactor } from "./recorder";
import { deepEqual } from "./deep-equal";
import { identify } from "./identity";

export interface HarnessOptions {
  /** Hand-authored stubs. */
  stubs?: Stub[];
  /** Extra resolvers, appended AFTER the stub resolver. */
  resolvers?: Resolver[];
  /** What to do on an un-stubbed call. Default "passthrough". */
  onUnhandled?: UnhandledPolicy;
  /** Applied to every recorded call before storage. */
  redact?: Redactor;
}

export class Harness {
  readonly resolvers: Resolver[];
  private readonly recorder: Recorder;
  private readonly onUnhandled: UnhandledPolicy;

  constructor(opts: HarnessOptions = {}) {
    this.resolvers = [predicateResolver(opts.stubs ?? []), ...(opts.resolvers ?? [])];
    this.recorder = new Recorder(opts.redact);
    this.onUnhandled = opts.onUnhandled ?? "passthrough";
  }

  get trajectory(): readonly Call[] {
    return this.recorder.trajectory;
  }

  callsTo(name: string): Call[] {
    return this.trajectory.filter((c) => c.name === name);
  }

  calledWith(name: string, input: unknown): boolean {
    return this.trajectory.some((c) => c.name === name && deepEqual(c.input, input));
  }

  reset(): void {
    this.recorder.reset();
  }

  /**
   * Resolve a call: first matching resolver wins (stub); otherwise apply the
   * unhandled-call policy. Records the call (or failure) either way.
   */
  async dispatch(
    kind: CallKind,
    name: string,
    input: unknown,
    original: () => Promise<unknown>,
  ): Promise<unknown> {
    const key = identify(kind, name, input);

    for (const resolve of this.resolvers) {
      const hit = resolve({ kind, name, input });
      if (!hit) continue;
      try {
        const output = await hit.produce();
        this.push(kind, name, input, key, { stubbed: true, output });
        return output;
      } catch (error) {
        this.push(kind, name, input, key, { stubbed: true, error });
        throw error;
      }
    }

    if (this.onUnhandled === "error") {
      const error = new Error(`mockist: unhandled ${kind} call "${name}" (onUnhandled: 'error')`);
      this.push(kind, name, input, key, { stubbed: false, error });
      throw error;
    }
    if (this.onUnhandled === "warn") {
      console.warn(`mockist: unhandled ${kind} call "${name}" — passing through`);
    }

    try {
      const output = await original();
      this.push(kind, name, input, key, { stubbed: false, output });
      return output;
    } catch (error) {
      this.push(kind, name, input, key, { stubbed: false, error });
      throw error;
    }
  }

  private push(
    kind: CallKind,
    name: string,
    input: unknown,
    key: string,
    outcome: { stubbed: boolean; output?: unknown; error?: unknown },
  ): void {
    this.recorder.record({ kind, name, input, key, ts: Date.now(), ...outcome });
  }
}

export function createHarness(opts?: HarnessOptions): Harness {
  return new Harness(opts);
}
