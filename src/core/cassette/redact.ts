import type { Call } from "../types";

/** Lowercased key names whose values are scrubbed by the default redactor. */
export const SECRET_KEYS = new Set([
  "authorization", "api_key", "apikey", "token", "password", "secret", "cookie", "set-cookie",
]);

const REDACTED_RE = /^\[REDACTED(?::[^\]]*)?\]$/;

/** The placeholder written in place of a scrubbed value; names the field for reviewers. */
export function redactionSentinel(key: string): string {
  return `[REDACTED:${key}]`;
}

/** True when a value is a redaction placeholder (and thus a match wildcard on replay). */
export function isRedacted(value: unknown): boolean {
  return typeof value === "string" && REDACTED_RE.test(value);
}

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.has(k.toLowerCase()) ? redactionSentinel(k) : scrub(v);
    }
    return out;
  }
  return value;
}

/**
 * Default redactor: deep-scrub secret-keyed values in input and output. Pure (no mutation).
 * Note: error messages are NOT redacted — a secret echoed in an upstream error message will
 * be written to the cassette.
 */
export function defaultRedactor(call: Call): Call {
  return { ...call, input: scrub(call.input), output: scrub(call.output) };
}
