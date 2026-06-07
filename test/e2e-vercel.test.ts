import { expect, test } from "vitest";
import { generateText, stepCountIs, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { createHarness, wrapVercelTools } from "../src/index";

// V3 boilerplate, kept local to the test.
const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};
const toolCallStep = (toolName: string, input: unknown, id: string) => ({
  content: [{ type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});
const textStep = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});

// Scripts the model: returns each step on successive calls, repeating the last.
type Step = ReturnType<typeof toolCallStep> | ReturnType<typeof textStep>;
function scripted(...steps: Step[]) {
  let i = 0;
  return new MockLanguageModelV3({ doGenerate: async () => steps[Math.min(i++, steps.length - 1)]! });
}

function weatherTool(onExecute: () => void) {
  return {
    get_weather: tool({
      description: "Get the weather for a city",
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => { onExecute(); return { tempC: 99, city }; },
    }),
  };
}

test("stub is returned to the model loop; real execute never runs", async () => {
  let real = 0;
  const harness = createHarness({
    stubs: [{ name: "get_weather", args: { city: "Paris" }, result: { tempC: 21, city: "Paris" } }],
  });
  const model = scripted(toolCallStep("get_weather", { city: "Paris" }, "c1"), textStep("It is 21C in Paris."));

  const result = await generateText({
    model,
    tools: wrapVercelTools(weatherTool(() => { real++; }), harness),
    prompt: "Weather in Paris?",
    stopWhen: stepCountIs(5),
  });

  expect(real).toBe(0);
  expect(result.text).toContain("21C");
  expect(harness.trajectory).toHaveLength(1);
  expect(harness.trajectory[0]).toMatchObject({ name: "get_weather", stubbed: true, output: { tempC: 21, city: "Paris" } });
});

test("unstubbed tool passes through to the real execute", async () => {
  let real = 0;
  const harness = createHarness({
    stubs: [{ name: "get_weather", args: { city: "Paris" }, result: { tempC: 21, city: "Paris" } }],
  });
  const model = scripted(toolCallStep("get_weather", { city: "Berlin" }, "c2"), textStep("done"));

  await generateText({
    model,
    tools: wrapVercelTools(weatherTool(() => { real++; }), harness),
    prompt: "Weather in Berlin?",
    stopWhen: stepCountIs(5),
  });

  expect(real).toBe(1);
  expect(harness.trajectory[0]).toMatchObject({ name: "get_weather", stubbed: false, output: { tempC: 99, city: "Berlin" } });
});

test("an error-injecting stub records the failure and the agent runs its failure path", async () => {
  let real = 0;
  const harness = createHarness({
    stubs: [{ name: "get_weather", result: () => { throw new Error("upstream 503"); } }],
  });
  const model = scripted(toolCallStep("get_weather", { city: "Paris" }, "c3"), textStep("Sorry, weather is unavailable."));

  const result = await generateText({
    model,
    tools: wrapVercelTools(weatherTool(() => { real++; }), harness),
    prompt: "Weather in Paris?",
    stopWhen: stepCountIs(5),
  });

  expect(real).toBe(0);
  expect(harness.trajectory[0]).toMatchObject({ name: "get_weather", stubbed: true });
  expect(harness.trajectory[0]!.error).toBeInstanceOf(Error);
  expect(result.text).toContain("unavailable");
});
