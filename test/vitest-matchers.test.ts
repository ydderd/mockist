import { expect, test } from "vitest";
import "../src/matchers/vitest";
import { createHarness } from "../src/core/harness";

test("expect(harness).toHaveCalledTool passes when tool was called", async () => {
  const harness = createHarness({ stubs: [{ name: "weather", result: { tempC: 21 } }] });
  await harness.dispatch("tool", "weather", { city: "Paris" }, async () => ({ tempC: 99 }));
  expect(harness).toHaveCalledTool("weather");
});

test("expect(harness).toHaveToolTrajectory asserts exact order", async () => {
  const harness = createHarness({
    stubs: [
      { name: "a", result: 1 },
      { name: "b", result: 2 },
    ],
  });
  await harness.dispatch("tool", "a", {}, async () => 0);
  await harness.dispatch("tool", "b", {}, async () => 0);
  expect(harness).toHaveToolTrajectory([{ name: "a" }, { name: "b" }]);
});

test("expect(harness).toHaveNoPassthroughToolCalls fails when real tool ran", async () => {
  const harness = createHarness();
  await harness.dispatch("tool", "x", {}, async () => "live");
  expect(() => expect(harness).toHaveNoPassthroughToolCalls()).toThrow();
});
