import { expect, test, vi } from "vitest";
import { defineStubs, predicateResolver } from "../src/core/registry";

test("name-only stub matches any input for that name", () => {
  const resolve = predicateResolver(defineStubs([{ name: "ping", result: "pong" }]));
  expect(resolve({ kind: "tool", name: "ping", input: { a: 1 } })?.produce()).toBe("pong");
  expect(resolve({ kind: "tool", name: "ping", input: { a: 2 } })?.produce()).toBe("pong");
});

test("name+args stub matches only on deep-equal input", () => {
  const resolve = predicateResolver(defineStubs([{ name: "w", args: { city: "Paris" }, result: 21 }]));
  expect(resolve({ kind: "tool", name: "w", input: { city: "Paris" } })?.produce()).toBe(21);
  expect(resolve({ kind: "tool", name: "w", input: { city: "Berlin" } })).toBeUndefined();
});

test("predicate match takes precedence over args", () => {
  const resolve = predicateResolver(defineStubs([{ name: "w", match: (i) => i.city.startsWith("P"), result: 9 }]));
  expect(resolve({ kind: "tool", name: "w", input: { city: "Prague" } })?.produce()).toBe(9);
  expect(resolve({ kind: "tool", name: "w", input: { city: "Oslo" } })).toBeUndefined();
});

test("result functions run only when produced, with the input", () => {
  const fn = vi.fn((i: { msg: string }) => i.msg.toUpperCase());
  const resolve = predicateResolver(defineStubs([{ name: "echo", result: fn }]));
  const hit = resolve({ kind: "tool", name: "echo", input: { msg: "hi" } });
  expect(fn).not.toHaveBeenCalled(); // not invoked during matching
  expect(hit?.produce()).toBe("HI");
  expect(fn).toHaveBeenCalledTimes(1);
});

test("a throwing result function does not throw during matching", () => {
  const resolve = predicateResolver(defineStubs([{ name: "boom", result: () => { throw new Error("x"); } }]));
  const hit = resolve({ kind: "tool", name: "boom", input: {} });
  expect(hit).toBeDefined();          // matching succeeds
  expect(() => hit!.produce()).toThrow("x"); // throwing is deferred to produce()
});

test("kind must match (default kind is tool); first match wins", () => {
  const resolve = predicateResolver(defineStubs([
    { name: "x", args: { a: 1 }, result: "first" },
    { name: "x", result: "second" },
  ]));
  expect(resolve({ kind: "tool", name: "x", input: { a: 1 } })?.produce()).toBe("first");
  expect(resolve({ kind: "tool", name: "x", input: { a: 2 } })?.produce()).toBe("second");
  expect(resolve({ kind: "skill", name: "x", input: { a: 1 } })).toBeUndefined();
});

test("sequence stubs do not advance until produce() runs", () => {
  const resolve = predicateResolver(defineStubs([
    { name: "retry", sequence: [{ result: "first" }, { result: "second" }] },
  ]));

  const first = resolve({ kind: "tool", name: "retry", input: {} });
  const second = resolve({ kind: "tool", name: "retry", input: {} });
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  expect(first?.produce()).toBe("first");
  expect(second?.produce()).toBe("second");
});

test("sequence stubs consume one step per matching call", () => {
  const resolve = predicateResolver(defineStubs([
    {
      name: "retry",
      sequence: [
        { result: "first" },
        { result: (input: { value: string }) => input.value.toUpperCase() },
      ],
    },
  ]));

  expect(resolve({ kind: "tool", name: "retry", input: { value: "a" } })?.produce()).toBe("first");
  expect(resolve({ kind: "tool", name: "retry", input: { value: "b" } })?.produce()).toBe("B");
});

test("sequence stubs can throw a step error", () => {
  const resolve = predicateResolver(defineStubs([
    { name: "flaky", sequence: [{ error: new Error("timeout") }, { result: "ok" }] },
  ]));

  expect(() => resolve({ kind: "tool", name: "flaky", input: {} })?.produce()).toThrow("timeout");
  expect(resolve({ kind: "tool", name: "flaky", input: {} })?.produce()).toBe("ok");
});

test("sequence stubs error on exhaustion by default", () => {
  const resolve = predicateResolver(defineStubs([
    { name: "once", sequence: [{ result: "only" }] },
  ]));

  expect(resolve({ kind: "tool", name: "once", input: {} })?.produce()).toBe("only");
  expect(() => resolve({ kind: "tool", name: "once", input: {} })?.produce()).toThrow(/exhausted/);
});

test("sequence stubs can repeat the last step when exhausted", () => {
  const resolve = predicateResolver(defineStubs([
    { name: "repeat", sequence: [{ result: "last" }], onSequenceExhausted: "repeat-last" },
  ]));

  expect(resolve({ kind: "tool", name: "repeat", input: {} })?.produce()).toBe("last");
  expect(resolve({ kind: "tool", name: "repeat", input: {} })?.produce()).toBe("last");
});

test("sequence stubs can pass through when exhausted", () => {
  const resolve = predicateResolver(defineStubs([
    { name: "fallthrough", sequence: [{ result: "stubbed" }], onSequenceExhausted: "passthrough" },
  ]));

  expect(resolve({ kind: "tool", name: "fallthrough", input: {} })?.produce()).toBe("stubbed");
  expect(resolve({ kind: "tool", name: "fallthrough", input: {} })).toBeUndefined();
});
