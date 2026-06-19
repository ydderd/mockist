import type { Harness } from "./harness";
import type { Call } from "./types";

/**
 * Concatenate trajectory segments in explicit workflow order.
 *
 * Use when each agent loop has its own harness (sequential handoffs) and you
 * know the segment order. Prefer a single shared harness when you control
 * assembly and calls are naturally interleaved (nested sub-agent loops).
 */
export function concatTrajectories(...segments: readonly (readonly Call[])[]): Call[] {
  const out: Call[] = [];
  for (const segment of segments) {
    for (const call of segment) {
      out.push(call);
    }
  }
  return out;
}

/** Convenience: `concatTrajectories(harnesses.map(h => h.trajectory))`. */
export function mergeHarnessTrajectories(...harnesses: Harness[]): Call[] {
  return concatTrajectories(...harnesses.map((h) => h.trajectory));
}
