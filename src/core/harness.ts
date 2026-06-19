import type { Call, CallKind, Resolver, SequenceStubState, Stub, UnhandledPolicy } from "./types";
import { predicateResolver, type ResettableResolver } from "./registry";
import { Recorder, type Redactor } from "./recorder";
import { deepEqual } from "./deep-equal";
import { identify } from "./identity";
import type { CassetteState } from "./types";
import { createCassetteResolver, type CassetteResolver } from "./cassette/resolver";
import { loadCassetteEntries, writeCassette } from "./cassette/io";
import { defaultRedactor } from "./cassette/redact";
import { registerPendingSave } from "./cassette/registry";

export interface HarnessOptions {
  /** Hand-authored stubs. */
  stubs?: Stub[];
  /** Extra resolvers, appended AFTER the stub resolver. */
  resolvers?: Resolver[];
  /** What to do on an un-stubbed call. Default "passthrough". */
  onUnhandled?: UnhandledPolicy;
  /** Applied to every recorded call before storage. */
  redact?: Redactor;
  /** Path to a JSON cassette: recorded calls replayed as stubs (or written when MOCKIST_RECORD is set). */
  cassette?: string;
}

export class Harness {
  readonly resolvers: Resolver[];
  private readonly recorder: Recorder;
  private readonly onUnhandled: UnhandledPolicy;
  private readonly resetResolvers: Array<() => void>;
  private readonly stubResolver: ResettableResolver;
  private readonly cassettePath?: string;
  private readonly recording: boolean;
  private readonly cassette?: CassetteResolver;
  /** Survives reset() so runner afterEach flush can save after harness.reset() clears the recorder. */
  private readonly cassetteSaveBuffer: Call[] = [];

  constructor(opts: HarnessOptions = {}) {
    const stubResolver = predicateResolver(opts.stubs ?? []);
    this.stubResolver = stubResolver;
    this.resetResolvers = [stubResolver.reset];
    this.cassettePath = opts.cassette;
    this.recording = Boolean(opts.cassette) && Boolean(process.env.MOCKIST_RECORD);

    const cassetteResolvers: Resolver[] = [];
    if (opts.cassette && !this.recording) {
      const cassette = createCassetteResolver(loadCassetteEntries(opts.cassette));
      this.cassette = cassette;
      cassetteResolvers.push(cassette.resolve);
      this.resetResolvers.push(cassette.reset);
    }
    this.resolvers = [stubResolver, ...cassetteResolvers, ...(opts.resolvers ?? [])];

    if (this.recording && opts.onUnhandled === "error") {
      console.warn(`mockist: recording "${opts.cassette}" — ignoring onUnhandled:"error" so real tools run.`);
    }
    this.onUnhandled = this.recording ? "passthrough" : (opts.onUnhandled ?? "passthrough");
    this.recorder = new Recorder(opts.redact ?? (this.recording ? defaultRedactor : undefined));

    if (this.recording) registerPendingSave(() => this.save());
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

  /** Consumption/exhaustion state of each sequence stub — for "no exhausted sequences" assertions. */
  sequenceState(): SequenceStubState[] {
    return this.stubResolver.sequenceState();
  }

  /** Cassette coverage: matched/missed calls and unused recorded entries. */
  cassetteState(): CassetteState {
    const base = this.cassette?.state() ?? { matched: [], missed: [], unused: [] };
    return { path: this.cassettePath ?? "", entries: [...(this.cassette?.entries ?? [])], ...base };
  }

  /** Write the cassette in record mode; a no-op otherwise. Driven by the runner setup hook. */
  async save(): Promise<void> {
    if (!this.recording || !this.cassettePath || this.cassetteSaveBuffer.length === 0) return;
    await writeCassette(this.cassettePath, this.cassetteSaveBuffer, { now: new Date().toISOString() });
    this.cassetteSaveBuffer.length = 0;
  }

  reset(): void {
    this.recorder.reset();
    for (const reset of this.resetResolvers) reset();
  }

  /**
   * Append a call directly to the trajectory without running the resolver pipeline.
   * Use to mark sub-agent / handoff boundaries when loops use separate harnesses
   * and you merge with {@link mergeHarnessTrajectories}.
   *
   * Not written to cassettes in record mode — handoff markers are trajectory-only;
   * replay consumes cassette entries only via {@link dispatch}.
   */
  recordCall(
    kind: CallKind,
    name: string,
    input: unknown,
    outcome: { stubbed: boolean; output?: unknown; error?: unknown } = { stubbed: true },
  ): void {
    const key = identify(kind, name, input);
    this.recorder.record({ kind, name, input, key, ts: Date.now(), ...outcome });
  }

  /**
   * Record a tool outcome observed outside {@link dispatch} (e.g. Claude PostToolUse hooks).
   * Persists to the cassette save buffer in record mode, unlike {@link recordCall}.
   */
  captureCall(
    kind: CallKind,
    name: string,
    input: unknown,
    outcome: { stubbed: boolean; output?: unknown; error?: unknown },
  ): void {
    const key = identify(kind, name, input);
    this.push(kind, name, input, key, outcome);
  }

  /**
   * Run the resolver chain without recording or invoking the real tool.
   * Used by SDK hook adapters (e.g. Claude PreToolUse) to decide stub vs passthrough.
   *
   * Returns a `produce` thunk on stub hits — the caller must invoke it (and record via
   * {@link captureCall}) so sequence/cassette state is not consumed without a trajectory entry.
   */
  async resolveCall(
    kind: CallKind,
    name: string,
    input: unknown,
  ): Promise<
    | { matched: true; passthrough: true }
    | { matched: true; produce: () => Promise<unknown> }
    | { matched: false }
  > {
    for (const resolve of this.resolvers) {
      const hit = resolve({ kind, name, input });
      if (!hit) continue;
      if (hit.passthrough) return { matched: true, passthrough: true };
      return { matched: true, produce: () => Promise.resolve(hit.produce()) };
    }
    if (this.onUnhandled === "error") {
      const error = new Error(`mockist: unhandled ${kind} call "${name}" (onUnhandled: 'error')`);
      this.recordCall(kind, name, input, { stubbed: false, error });
      throw error;
    }
    if (this.onUnhandled === "warn") {
      console.warn(`mockist: unhandled ${kind} call "${name}" — passing through`);
    }
    return { matched: false };
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

    // A matched stub may explicitly defer to the real tool (exhausted passthrough sequence);
    // that delegation must bypass the onUnhandled policy below.
    let deferToOriginal = false;
    for (const resolve of this.resolvers) {
      const hit = resolve({ kind, name, input });
      if (!hit) continue;
      if (hit.passthrough) {
        deferToOriginal = true;
        break;
      }
      try {
        const output = await hit.produce();
        this.push(kind, name, input, key, { stubbed: true, output });
        return output;
      } catch (error) {
        this.push(kind, name, input, key, { stubbed: true, error });
        throw error;
      }
    }

    if (!deferToOriginal && this.onUnhandled === "error") {
      const error = new Error(`mockist: unhandled ${kind} call "${name}" (onUnhandled: 'error')`);
      this.push(kind, name, input, key, { stubbed: false, error });
      throw error;
    }
    if (!deferToOriginal && this.onUnhandled === "warn") {
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
    if (this.recording) {
      this.cassetteSaveBuffer.push(this.trajectory[this.trajectory.length - 1]!);
    }
  }
}

export function createHarness(opts?: HarnessOptions): Harness {
  return new Harness(opts);
}
