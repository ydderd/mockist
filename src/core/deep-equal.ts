import { stableStringify } from "./identity";

/** Structural equality via canonical JSON (reuses the identity normalizer). */
export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}
