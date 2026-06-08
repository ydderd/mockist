import type { CallKind } from "./types";

/** Deterministic JSON: object keys sorted recursively. */
export function stableStringify(value: unknown): string {
  // JSON.stringify collapses undefined and NaN to `null`/undefined; give each a
  // distinct, collision-safe token (bare words JSON output can never produce) so
  // args matching and call identity don't conflate them with null or each other.
  if (value === undefined) return "undefined";
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Stable identity for a call; used for recording and (later) fixture keys. */
export function identify(kind: CallKind, name: string, input: unknown): string {
  return `${kind}:${name}:${stableStringify(input)}`;
}
