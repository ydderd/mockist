import { expect, test } from "vitest";
import { identify, stableStringify } from "../src/core/identity";

test("identify is stable regardless of object key order", () => {
  expect(identify("tool", "w", { city: "Paris", units: "c" }))
    .toBe(identify("tool", "w", { units: "c", city: "Paris" }));
});

test("identify distinguishes kind, name, and input", () => {
  expect(identify("tool", "x", { a: 1 })).not.toBe(identify("skill", "x", { a: 1 }));
  expect(identify("tool", "x", { a: 1 })).not.toBe(identify("tool", "y", { a: 1 }));
  expect(identify("tool", "x", { a: 1 })).not.toBe(identify("tool", "x", { a: 2 }));
});

test("stableStringify sorts nested keys and handles arrays/null", () => {
  expect(stableStringify({ b: 1, a: [3, { y: 2, x: 1 }] })).toBe('{"a":[3,{"x":1,"y":2}],"b":1}');
  expect(stableStringify(null)).toBe("null");
});

test("stableStringify distinguishes null, undefined, and NaN", () => {
  expect(stableStringify(undefined)).not.toBe(stableStringify(null));
  expect(stableStringify(NaN)).not.toBe(stableStringify(null));
  expect(stableStringify(NaN)).not.toBe(stableStringify(undefined));
  // also nested, where these values actually survive object serialization
  expect(stableStringify({ a: undefined })).not.toBe(stableStringify({ a: null }));
  expect(stableStringify({ a: NaN })).not.toBe(stableStringify({ a: null }));
});
