/**
 * Vercel AI SDK integration with mockist
 * ======================================
 *
 * Install:  npm install mockist ai zod
 * In-repo:  imports below use ../../src/index — swap for "mockist" when published.
 *
 * WHERE TO WIRE mockist
 * ---------------------
 * Your app already passes a `tools` object into generateText / streamText /
 * generateObject. mockist wraps that object *once*, at the factory or test
 * setup boundary — same place you'd add logging or metrics.
 *
 *   const tools = wrapVercelTools(createMyTools(deps), harness);
 *   await generateText({ model, tools, prompt });
 *
 * WHAT GETS RECORDED
 * ------------------
 * Every tool `execute(input)` the model triggers flows through the harness.
 * Each call becomes one trajectory entry:
 *
 *   { kind: "tool", name, input, output|error, stubbed: true|false, ts, key }
 *
 * `stubbed: true`  → a declarative stub (or cassette) returned the result.
 * `stubbed: false` → the real execute ran (passthrough).
 */

import { generateText, stepCountIs, tool, type ToolSet } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import {
  createHarness,
  defineStubs,
  expectExactTrajectory,
  wrapVercelTools,
  type Harness,
} from "../../src/index";

// ---------------------------------------------------------------------------
// 1. Your production tool definitions (unchanged except they're wrapped later)
// ---------------------------------------------------------------------------

/** Real tool factory — in production this might close over prisma, fetch, etc. */
export function createWeatherTools() {
  return {
    get_weather: tool({
      description: "Get current temperature for a city",
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => {
        // In production: await fetch(`https://api.weather/...?city=${city}`)
        return { tempC: 99, city };
      },
    }),
    search_docs: tool({
      description: "Search internal documentation",
      inputSchema: z.object({ q: z.string() }),
      execute: async ({ q }) => {
        // In production: await vectorStore.search(q)
        return { hits: [`live:${q}`] };
      },
    }),
  } satisfies ToolSet;
}

// ---------------------------------------------------------------------------
// 2. Harness + stubs — declare what the agent *should* see at the boundary
// ---------------------------------------------------------------------------

/** Shared suite stubs — merge with per-test overrides via spread (first match wins). */
export const SUITE_STUBS = defineStubs([
  {
    name: "get_weather",
    args: { city: "Paris" },
    result: { tempC: 21, city: "Paris" },
  },
  {
    name: "search_docs",
    match: (input: { q: string }) => input.q.includes("billing"),
    result: { hits: ["invoice-faq"] },
  },
]);

export function createAgentHarness(overrides?: Parameters<typeof createHarness>[0]) {
  return createHarness({
    stubs: [...SUITE_STUBS],
    // "error" = test fails if the model calls a tool you didn't stub.
    // "passthrough" = unstubbed calls run real execute (integration tests).
    onUnhandled: "error",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// 3. Wire mockist at the tool boundary (the one-line chokepoint)
// ---------------------------------------------------------------------------

export function wireMockist(tools: ToolSet, harness: Harness): ToolSet {
  return wrapVercelTools(tools, harness);
}

// ---------------------------------------------------------------------------
// 4. Drive the agent loop (test uses MockLanguageModelV3; prod uses a real model)
// ---------------------------------------------------------------------------

const MOCK_USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

/**
 * Script a model that calls one tool then replies with text.
 * In production you pass your real `anthropic('claude-...')` / `openai('gpt-...')` model.
 */
export function scriptedModel(toolName: string, toolInput: unknown, finalText: string) {
  let step = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      if (step++ === 0) {
        return {
          content: [{
            type: "tool-call" as const,
            toolCallId: "call_1",
            toolName,
            input: JSON.stringify(toolInput),
          }],
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage: MOCK_USAGE,
          warnings: [],
        };
      }
      return {
        content: [{ type: "text" as const, text: finalText }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: MOCK_USAGE,
        warnings: [],
      };
    },
  });
}

/**
 * Full integration: harness → wrap tools → generateText → trajectory.
 * Returns both the SDK result and the harness for assertions.
 */
export async function runWeatherAgent(opts: {
  harness: Harness;
  prompt?: string;
  city?: string;
}) {
  const tools = wireMockist(createWeatherTools(), opts.harness);
  const city = opts.city ?? "Paris";

  const result = await generateText({
    model: scriptedModel("get_weather", { city }, `It is 21C in ${city}.`),
    tools,
    prompt: opts.prompt ?? `What's the weather in ${city}?`,
    stopWhen: stepCountIs(5),
  });

  return { result, harness: opts.harness };
}

/** Assert the agent called get_weather with stubbed output (no real API hit). */
export function assertWeatherStubTrajectory(harness: Harness, city = "Paris") {
  return expectExactTrajectory(harness.trajectory, [{
    name: "get_weather",
    input: { city },
    output: { tempC: 21, city },
    stubbed: true,
  }]);
}
