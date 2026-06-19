/**
 * CI verification for examples/schema-grounded/integration.ts
 */
import { expect, test } from "vitest";
import {
  assertStubsMatchSchemas,
  createSchemaGroundedHarness,
  generateWeatherStubs,
  runPassthroughWeather,
  TOOL_CATALOG,
} from "./integration";
import { defineStubs, stubsFromSchemas } from "../../src/index";
import { SchemaValidationError } from "../../src/core/schema";

test("integration: generateWeatherStubs produces valid fixtures", () => {
  const stubs = generateWeatherStubs();
  expect(stubs[0]).toMatchObject({ name: "get_weather", result: { tempC: 21, city: "Paris" } });
  assertStubsMatchSchemas(stubs);
});

test("integration: assertStubsMatchSchemas rejects drift", () => {
  const bad = defineStubs([{ name: "get_weather", result: { tempC: "warm", city: "Paris" } }]);
  expect(() => assertStubsMatchSchemas(bad, TOOL_CATALOG)).toThrow(SchemaValidationError);
});

test("integration: createSchemaGroundedHarness is ready to use", async () => {
  const harness = createSchemaGroundedHarness();
  const tools = { get_weather: { execute: async () => ({ tempC: 21, city: "Paris" }) } };
  const { wrapVercelTools } = await import("../../src/index");
  await wrapVercelTools(tools, harness).get_weather.execute!({ city: "Paris" });
  expect(harness.trajectory[0]!.stubbed).toBe(true);
});

test("integration: runPassthroughWeather validates live output against schema", async () => {
  const harness = await runPassthroughWeather("Berlin");
  expect(harness.trajectory[0]).toMatchObject({
    stubbed: false,
    output: { tempC: 18, city: "Berlin" },
  });
});

test("integration: stubsFromSchemas raw placeholders", () => {
  expect(stubsFromSchemas(TOOL_CATALOG)).toEqual([{ name: "get_weather", result: { tempC: 0, city: "" } }]);
});
