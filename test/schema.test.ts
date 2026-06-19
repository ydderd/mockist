import { expect, test } from "vitest";
import {
  placeholderFromSchema,
  stubsFromSchemas,
  validateAgainstJsonSchema,
  validateStubsAgainstSchemas,
  validateTrajectoryOutputs,
  SchemaValidationError,
} from "../src/core/schema";
import { defineStubs } from "../src/core/registry";
import { createHarness } from "../src/core/harness";
import { wrapVercelTools } from "../src/adapters/vercel";

test("validateAgainstJsonSchema checks object required fields", () => {
  validateAgainstJsonSchema({ city: "Paris" }, {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  });
  expect(() =>
    validateAgainstJsonSchema({}, { type: "object", required: ["city"] }),
  ).toThrow(SchemaValidationError);
});

test("stubsFromSchemas generates placeholder stubs from output schemas", () => {
  const stubs = stubsFromSchemas([
    { name: "weather", outputSchema: { type: "object", properties: { tempC: { type: "number" } } } },
  ]);
  expect(stubs).toEqual([{ name: "weather", result: { tempC: 0 } }]);
});

test("validateStubsAgainstSchemas rejects drifted stub output", () => {
  const stubs = defineStubs([{ name: "weather", result: { tempC: "hot" } }]);
  expect(() =>
    validateStubsAgainstSchemas(stubs, [
      { name: "weather", outputSchema: { type: "object", properties: { tempC: { type: "number" } } } },
    ]),
  ).toThrow(SchemaValidationError);
});

test("placeholderFromSchema handles enums", () => {
  expect(placeholderFromSchema({ enum: ["a", "b"] })).toBe("a");
});

test("validateStubsAgainstSchemas validates function stubs when args provided", () => {
  const stubs = defineStubs([
    { name: "weather", args: { city: "Paris" }, result: ({ city }: { city: string }) => ({ tempC: 21, city }) },
  ]);
  expect(() =>
    validateStubsAgainstSchemas(stubs, [
      { name: "weather", outputSchema: { type: "object", properties: { tempC: { type: "number" }, city: { type: "string" } } } },
    ]),
  ).not.toThrow();
});

test("validateStubsAgainstSchemas skips function stubs without args", () => {
  const stubs = defineStubs([{ name: "weather", result: () => ({ tempC: "bad" }) }]);
  expect(() =>
    validateStubsAgainstSchemas(stubs, [
      { name: "weather", outputSchema: { type: "object", properties: { tempC: { type: "number" } } } },
    ]),
  ).not.toThrow();
});

test("validateTrajectoryOutputs checks passthrough outputs", async () => {
  const harness = createHarness();
  await wrapVercelTools(
    { get_weather: { execute: async (_input: { city: string }) => ({ tempC: 18, city: "Berlin" }) } },
    harness,
  ).get_weather.execute!({ city: "Berlin" });
  expect(() =>
    validateTrajectoryOutputs(harness.trajectory, [
      { name: "get_weather", outputSchema: { type: "object", properties: { tempC: { type: "number" }, city: { type: "string" } } } },
    ]),
  ).not.toThrow();
});
