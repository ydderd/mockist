import { expect, test } from "vitest";
import {
  placeholderFromSchema,
  stubsFromSchemas,
  validateAgainstJsonSchema,
  validateStubsAgainstSchemas,
  SchemaValidationError,
} from "../src/core/schema";
import { defineStubs } from "../src/core/registry";

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
