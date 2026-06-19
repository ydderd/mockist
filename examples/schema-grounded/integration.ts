/**
 * Schema-grounded stubs
 * =====================
 *
 * Tool definitions already carry JSON Schema (Zod → JSON Schema, MCP inputSchema,
 * OpenAI parameters). mockist can:
 *
 * 1. GENERATE starter stubs from output schemas:
 *      const stubs = stubsFromSchemas(toolDefs);
 *
 * 2. VALIDATE hand-written stubs haven't drifted:
 *      validateStubsAgainstSchemas(myStubs, toolDefs);
 *
 * 3. VALIDATE passthrough trajectory outputs (optional sanity check):
 *      validateTrajectoryOutputs(harness.trajectory, toolDefs);
 *
 * Run (2) in a beforeAll() or test setup so bad fixtures fail before the agent runs.
 */

import {
  createHarness,
  defineStubs,
  stubsFromSchemas,
  validateStubsAgainstSchemas,
  validateTrajectoryOutputs,
  wrapVercelTools,
  type ToolSchemaDef,
  type Stub,
} from "../../src/index";

// ---------------------------------------------------------------------------
// 1. Tool schema defs — mirror what you ingest from SDK tool definitions
// ---------------------------------------------------------------------------

export const WEATHER_TOOL_DEF: ToolSchemaDef = {
  name: "get_weather",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
  outputSchema: {
    type: "object",
    properties: {
      tempC: { type: "number" },
      city: { type: "string" },
    },
    required: ["tempC", "city"],
  },
};

export const TOOL_CATALOG: ToolSchemaDef[] = [WEATHER_TOOL_DEF];

// ---------------------------------------------------------------------------
// 2. Generate + customize stubs
// ---------------------------------------------------------------------------

/** Placeholder values from schema — edit results to match realistic fixtures. */
export function generateWeatherStubs(): Stub[] {
  const generated = stubsFromSchemas(TOOL_CATALOG);
  // Customize placeholders:
  return generated.map((s) =>
    s.name === "get_weather"
      ? { ...s, args: { city: "Paris" }, result: { tempC: 21, city: "Paris" } }
      : s,
  );
}

/** Call in test setup — throws SchemaValidationError if stub output doesn't match schema. */
export function assertStubsMatchSchemas(stubs: Stub[], catalog = TOOL_CATALOG) {
  validateStubsAgainstSchemas(stubs, catalog);
}

// ---------------------------------------------------------------------------
// 3. Example harness wired with validated stubs
// ---------------------------------------------------------------------------

export function createSchemaGroundedHarness() {
  const stubs = defineStubs(generateWeatherStubs());
  assertStubsMatchSchemas(stubs);
  return createHarness({ stubs });
}

export async function runPassthroughWeather(city = "Berlin") {
  const harness = createHarness({ onUnhandled: "passthrough" });
  const tools = wrapVercelTools(
    { get_weather: { execute: async () => ({ tempC: 18, city }) } },
    harness,
  );
  await tools.get_weather.execute!({ city });
  validateTrajectoryOutputs(harness.trajectory, TOOL_CATALOG);
  return harness;
}
