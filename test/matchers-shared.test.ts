import { expect, test } from "vitest";
import { mockistMatchers } from "../src/matchers/shared";
import { createHarness } from "../src/core/harness";

test("mockistMatchers exposes all trajectory helpers", async () => {
  const harness = createHarness({
    stubs: [{ name: "a", result: 1 }, { name: "b", result: 2 }],
  });
  await harness.dispatch("tool", "a", {}, async () => 0);
  await harness.dispatch("tool", "b", {}, async () => 0);

  const m = mockistMatchers(harness);
  expect(m.toHaveCalledTool("a").pass).toBe(true);
  expect(m.toHaveToolTrajectory([{ name: "a" }, { name: "b" }]).pass).toBe(true);
  expect(m.toHaveNoPassthroughToolCalls().pass).toBe(true);
  expect(m.toHaveNoUnhandledToolCalls().pass).toBe(true);
  expect(m.toHaveNoExhaustedStubSequences().pass).toBe(true);
});

test("mockistMatchers toHaveCalledWith uses deep-subset", async () => {
  const harness = createHarness({ stubs: [{ name: "search", result: [] }] });
  await harness.dispatch("tool", "search", { q: "mockist", limit: 10 }, async () => []);
  expect(mockistMatchers(harness).toHaveCalledWith("search", { q: "mockist" }).pass).toBe(true);
});

test("mockistMatchers failure messages are non-empty", async () => {
  const harness = createHarness();
  const result = mockistMatchers(harness).toHaveCalledTool("missing");
  expect(result.pass).toBe(false);
  expect(result.message()).toContain("missing");
});
