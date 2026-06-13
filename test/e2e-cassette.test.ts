import { afterAll, afterEach, expect, test, vi } from "vitest";
import { generateText, stepCountIs, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness, wrapVercelTools } from "../src/index";
import { expectCassetteFullyUsed, cassetteExpectedCalls, expectExactTrajectory } from "../src/index";

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};
const toolCallStep = (toolName: string, input: unknown, id: string) => ({
  content: [{ type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage: USAGE, warnings: [],
});
const textStep = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage: USAGE, warnings: [],
});
type Step = ReturnType<typeof toolCallStep> | ReturnType<typeof textStep>;
function scripted(...steps: Step[]) {
  let i = 0;
  return new MockLanguageModelV3({ doGenerate: async () => steps[Math.min(i++, steps.length - 1)]! });
}
function weatherTool(onExecute: (city: string) => void) {
  return {
    get_weather: tool({
      description: "Get the weather for a city",
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => { onExecute(city); return { tempC: 21, city }; },
    }),
  };
}

const dir = mkdtempSync(join(tmpdir(), "mockist-e2e-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => { delete process.env.MOCKIST_RECORD; });

test("record then replay: real tool runs once, replay serves from cassette", async () => {
  const path = join(dir, "weather.json");
  const model = () => scripted(toolCallStep("get_weather", { city: "Paris" }, "c1"), textStep("It is 21C in Paris."));

  // --- RECORD ---
  process.env.MOCKIST_RECORD = "1";
  const recordReal = vi.fn();
  const recHarness = createHarness({ cassette: path });
  await generateText({
    model: model(),
    tools: wrapVercelTools(weatherTool((c) => recordReal(c)), recHarness),
    prompt: "Weather in Paris?",
    stopWhen: stepCountIs(5),
  });
  await recHarness.save();
  expect(recordReal).toHaveBeenCalledWith("Paris");

  // --- REPLAY ---
  delete process.env.MOCKIST_RECORD;
  const replayReal = vi.fn();
  const harness = createHarness({ cassette: path, onUnhandled: "error" });
  const result = await generateText({
    model: model(),
    tools: wrapVercelTools(weatherTool((c) => replayReal(c)), harness),
    prompt: "Weather in Paris?",
    stopWhen: stepCountIs(5),
  });

  expect(replayReal).not.toHaveBeenCalled();         // served from cassette
  expect(result.text).toContain("21C");
  expect(expectExactTrajectory(harness.trajectory, cassetteExpectedCalls(harness)).pass).toBe(true);
  expect(expectCassetteFullyUsed(harness.cassetteState()).pass).toBe(true);
});
