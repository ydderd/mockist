/**
 * CI verification for examples/vitest-matchers/integration.ts
 */
import { expect, test } from "vitest";
import { createMatcherDemoHarness, runMatcherDemoAgent } from "./integration";

test("integration: trajectory matchers after demo agent run", async () => {
  const harness = createMatcherDemoHarness();
  await runMatcherDemoAgent(harness);

  expect(harness).toHaveCalledTool("context_recall");
  expect(harness).toHaveCalledWith("search", { q: "docs" });
  expect(harness).toHaveToolTrajectory([
    { name: "context_recall" },
    { name: "search" },
  ]);
  expect(harness).toHaveNoPassthroughToolCalls();
  expect(harness).toHaveNoUnhandledToolCalls();
});
