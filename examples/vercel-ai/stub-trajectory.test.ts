/**
 * CI verification for examples/vercel-ai/integration.ts
 */
import { expect, test } from "vitest";
import {
  assertWeatherStubTrajectory,
  createAgentHarness,
  runWeatherAgent,
} from "./integration";

test("integration: stubbed weather agent records trajectory", async () => {
  const harness = createAgentHarness();
  const { result } = await runWeatherAgent({ harness, city: "Paris" });

  expect(result.text).toContain("21C");
  const assertion = assertWeatherStubTrajectory(harness, "Paris");
  expect(assertion.pass, assertion.message()).toBe(true);
});
