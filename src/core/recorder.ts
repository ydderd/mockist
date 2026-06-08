import type { Call } from "./types";

/** Transforms a call before it is stored. Default is identity (no-op). */
export type Redactor = (call: Call) => Call;

/** In-memory trajectory of observed calls. */
export class Recorder {
  private calls: Call[] = [];
  private readonly redact: Redactor;

  constructor(redact: Redactor = (c) => c) {
    this.redact = redact;
  }

  record(call: Call): void {
    this.calls.push(this.redact(call));
  }

  get trajectory(): readonly Call[] {
    return this.calls;
  }

  reset(): void {
    this.calls = [];
  }
}
