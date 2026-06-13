import { expect, test } from "vitest";
import { createCassetteResolver } from "../src/core/cassette/resolver";
import type { RecordedEntry } from "../src/core/types";

test("serves matching entries and returns output", () => {
  const c = createCassetteResolver([{ name: "s", input: { q: "x" }, output: 42 }]);
  expect(c.resolve({ kind: "tool", name: "s", input: { q: "x" } })?.produce()).toBe(42);
});

test("consume-once: same key with error-then-ok replays in order", () => {
  const entries: RecordedEntry[] = [
    { name: "s", input: { q: "x" }, error: { name: "Error", message: "boom" } },
    { name: "s", input: { q: "x" }, output: "ok" },
  ];
  const c = createCassetteResolver(entries);
  expect(() => c.resolve({ kind: "tool", name: "s", input: { q: "x" } })?.produce()).toThrow("boom");
  expect(c.resolve({ kind: "tool", name: "s", input: { q: "x" } })?.produce()).toBe("ok");
});

test("a miss returns undefined and is recorded; unused entries are tracked", () => {
  const c = createCassetteResolver([{ name: "s", input: { q: "x" }, output: 1 }]);
  expect(c.resolve({ kind: "tool", name: "other", input: {} })).toBeUndefined();
  const s = c.state();
  expect(s.missed).toHaveLength(1);
  expect(s.matched).toHaveLength(0);
  expect(s.unused).toHaveLength(1);
});

test("reset re-arms consumption", () => {
  const c = createCassetteResolver([{ name: "s", input: {}, output: 1 }]);
  c.resolve({ kind: "tool", name: "s", input: {} })?.produce();
  expect(c.state().unused).toHaveLength(0);
  c.reset();
  expect(c.state().unused).toHaveLength(1);
  expect(c.state().matched).toHaveLength(0);
});
