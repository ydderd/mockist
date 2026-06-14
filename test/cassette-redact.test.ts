import { expect, test } from "vitest";
import { defaultRedactor, isRedacted, redactionSentinel } from "../src/core/cassette/redact";
import type { Call } from "../src/core/types";

const call = (input: unknown, output: unknown): Call => ({
  kind: "tool", name: "t", input, output, stubbed: false, ts: 0, key: "k",
});

test("redactionSentinel and isRedacted round-trip", () => {
  const s = redactionSentinel("authorization");
  expect(s).toBe("[REDACTED:authorization]");
  expect(isRedacted(s)).toBe(true);
  expect(isRedacted("[REDACTED]")).toBe(true);
  expect(isRedacted("hello")).toBe(false);
});

test("defaultRedactor scrubs secret-keyed values in input and output, deeply", () => {
  const out = defaultRedactor(call(
    { q: "x", headers: { authorization: "Bearer sk-live-9" } },
    { ok: true, token: "tok_live_xyz" },
  ));
  expect((out.input as any).headers.authorization).toBe("[REDACTED:authorization]");
  expect((out.output as any).token).toBe("[REDACTED:token]");
  expect((out.input as any).q).toBe("x"); // non-secret untouched
});

test("defaultRedactor does not mutate the original call", () => {
  const original = call({ password: "hunter2" }, null);
  defaultRedactor(original);
  expect((original.input as any).password).toBe("hunter2");
});
