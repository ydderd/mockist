/**
 * OpenAI integration with mockist
 * ===============================
 *
 * OpenAI tool calling appears in several shapes. mockist supports both:
 *
 * A) Tools with a local `execute` handler (Agents SDK, custom runners)
 *      const tools = wrapOpenAiTools({ get_weather: { execute, ... } }, harness);
 *      await tools.get_weather.execute({ city: "Paris" });
 *
 * B) Manual dispatch loop (Chat Completions / Responses API)
 *      When the API returns tool_calls[], you run tools yourself:
 *
 *      const runTool = createOpenAiToolInterceptor(harness, async (name, args) => {
 *        switch (name) {
 *          case "get_weather": return weatherService.fetch(args);
 *          default: throw new Error(`unknown: ${name}`);
 *        }
 *      });
 *
 *      for (const call of response.tool_calls) {
 *        const args = JSON.parse(call.function.arguments);
 *        const output = await runTool(call.function.name, args);
 *        // append tool result message, call model again...
 *      }
 *
 * TRAJECTORY
 * ----------
 * Same as Vercel: { kind: "tool", name, input, output|error, stubbed }
 */

import {
  createHarness,
  createOpenAiToolInterceptor,
  wrapOpenAiTools,
  defineStubs,
  type Harness,
} from "../../src/index";

// ---------------------------------------------------------------------------
// 1. Tool registry — OpenAI function definitions + local execute
// ---------------------------------------------------------------------------

export type OpenAiToolRegistry = Record<string, {
  type?: string;
  function?: { name: string; description?: string; parameters?: unknown };
  execute?: (input: unknown) => unknown | Promise<unknown>;
}>;

export function createOpenAiToolRegistry(): OpenAiToolRegistry {
  return {
    get_weather: {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather for a city",
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
      execute: async (input) => {
        const { city } = input as { city: string };
        return { tempC: 99, city };
      },
    },
    search: {
      type: "function",
      function: { name: "search", description: "Search docs", parameters: { type: "object" } },
      execute: async (input) => {
        const { q } = input as { q: string };
        return { hits: [`live:${q}`] };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Harness
// ---------------------------------------------------------------------------

export const OPENAI_SUITE_STUBS = defineStubs([
  { name: "get_weather", args: { city: "Paris" }, result: { tempC: 21 } },
  { name: "calc", args: { expression: "1+1" }, result: 2 },
  {
    name: "search",
    sequence: [{ error: new Error("rate limited") }, { result: { hits: ["a"] } }],
  },
]);

export function createOpenAiHarness(overrides?: Parameters<typeof createHarness>[0]) {
  return createHarness({ stubs: [...OPENAI_SUITE_STUBS], onUnhandled: "passthrough", ...overrides });
}

// ---------------------------------------------------------------------------
// 3A. wrapOpenAiTools — when each tool has execute()
// ---------------------------------------------------------------------------

export function wireOpenAiTools(harness: Harness, registry?: OpenAiToolRegistry) {
  const tools = registry ?? createOpenAiToolRegistry();
  return wrapOpenAiTools(tools, harness);
}

// ---------------------------------------------------------------------------
// 3B. Manual tool loop — Responses / Chat Completions style
// ---------------------------------------------------------------------------

export function createProductionToolRunner() {
  return async (name: string, args: unknown): Promise<unknown> => {
    const registry = createOpenAiToolRegistry();
    const tool = registry[name];
    if (!tool?.execute) throw new Error(`unknown tool: ${name}`);
    return tool.execute(args);
  };
}

export function wireOpenAiToolLoop(harness: Harness, runTool = createProductionToolRunner()) {
  return createOpenAiToolInterceptor(harness, runTool);
}

/**
 * Simulates one turn of an OpenAI tool-call loop (what you'd do inside your runner).
 */
export async function handleOpenAiToolCall(
  dispatch: ReturnType<typeof wireOpenAiToolLoop>,
  toolCall: { name: string; arguments: unknown },
) {
  return dispatch(toolCall.name, toolCall.arguments);
}
