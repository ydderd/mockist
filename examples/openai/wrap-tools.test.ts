/**
 * CI verification for examples/openai/integration.ts
 */
import { expect, test } from "vitest";
import {
  createOpenAiHarness,
  handleOpenAiToolCall,
  wireOpenAiToolLoop,
  wireOpenAiTools,
} from "./integration";

test("integration: wireOpenAiTools stubs execute", async () => {
  const harness = createOpenAiHarness();
  const tools = wireOpenAiTools(harness);

  const result = await tools.get_weather!.execute!({ city: "Paris" });
  expect(result).toEqual({ tempC: 21 });
  expect(harness.trajectory[0]).toMatchObject({ name: "get_weather", stubbed: true });
});

test("integration: wireOpenAiToolLoop for manual dispatch", async () => {
  const harness = createOpenAiHarness();
  const dispatch = wireOpenAiToolLoop(harness);

  const result = await handleOpenAiToolCall(dispatch, {
    name: "calc",
    arguments: { expression: "1+1" },
  });
  expect(result).toBe(2);
  expect(harness.trajectory[0]).toMatchObject({ name: "calc", stubbed: true });
});

test("integration: sequential search stub — error then success", async () => {
  const harness = createOpenAiHarness();
  const tools = wireOpenAiTools(harness);

  await expect(tools.search!.execute!({ q: "x" })).rejects.toThrow("rate limited");
  expect(await tools.search!.execute!({ q: "x" })).toEqual({ hits: ["a"] });
  expect(harness.trajectory[0]!.error).toBeInstanceOf(Error);
  expect(harness.trajectory[1]!.output).toEqual({ hits: ["a"] });
});
