/**
 * Jest matchers use the same mockistMatchers core as Vitest (see src/matchers/shared.ts).
 * Jest's expect.extend lives in @ydderd/mockist/jest-matchers — import that in jest setupFilesAfterEnv.
 * We avoid importing @jest/globals under Vitest here; see examples/vitest-matchers/README.md.
 */
import { expect, test } from "vitest";
import { mockistMatchers } from "../src/matchers/shared";

test("jest/vitest shared matcher core: toHaveCalledTool", async () => {
  const { createHarness } = await import("../src/core/harness");
  const harness = createHarness({ stubs: [{ name: "ping", result: "pong" }] });
  await harness.dispatch("tool", "ping", {}, async () => "live");
  expect(mockistMatchers(harness).toHaveCalledTool("ping").pass).toBe(true);
});

test("jest/vitest shared matcher core: toHaveToolTrajectory", async () => {
  const { createHarness } = await import("../src/core/harness");
  const harness = createHarness({
    stubs: [{ name: "a", result: 1 }, { name: "b", result: 2 }],
  });
  await harness.dispatch("tool", "a", {}, async () => 0);
  await harness.dispatch("tool", "b", {}, async () => 0);
  expect(mockistMatchers(harness).toHaveToolTrajectory([{ name: "a" }, { name: "b" }]).pass).toBe(true);
});
