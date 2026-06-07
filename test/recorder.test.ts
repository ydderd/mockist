import { expect, test } from "vitest";
import { Recorder } from "../src/core/recorder";
import type { Call } from "../src/core/types";

function call(partial: Partial<Call>): Call {
  return { kind: "tool", name: "x", input: {}, stubbed: false, ts: 0, key: "k", ...partial };
}

test("records calls in order and exposes the trajectory", () => {
  const rec = new Recorder();
  rec.record(call({ name: "a" }));
  rec.record(call({ name: "b" }));
  expect(rec.trajectory.map((c) => c.name)).toEqual(["a", "b"]);
});

test("reset clears the trajectory", () => {
  const rec = new Recorder();
  rec.record(call({}));
  rec.reset();
  expect(rec.trajectory).toHaveLength(0);
});

test("redactor is applied before storing (no-op by default)", () => {
  const rec = new Recorder((c) => ({ ...c, input: "[redacted]" }));
  rec.record(call({ input: { secret: "shh" } }));
  expect(rec.trajectory[0]!.input).toBe("[redacted]");
});
