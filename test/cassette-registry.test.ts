import { expect, test } from "vitest";
import { registerPendingSave, flushPendingSaves } from "../src/core/cassette/registry";

test("flush awaits all registered saves then clears", async () => {
  const order: string[] = [];
  registerPendingSave(async () => { order.push("a"); });
  registerPendingSave(async () => { order.push("b"); });
  await flushPendingSaves();
  expect(order).toEqual(["a", "b"]);
  await flushPendingSaves(); // already drained
  expect(order).toEqual(["a", "b"]);
});
