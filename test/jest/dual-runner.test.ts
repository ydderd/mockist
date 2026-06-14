import { afterAll, afterEach, describe, expect, it } from "@jest/globals";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHarness,
  defineStubs,
  wrapVercelTools,
  expectExactTrajectory,
  expectCalledWith,
  expectNoExhaustedSequences,
  expectCassetteFullyUsed,
  cassetteExpectedCalls,
} from "../../src/index";

/**
 * mockist ships a runner-agnostic core but advertises first-class Jest support
 * (`setupFilesAfterEnv: ["mockist/jest-setup"]`). These tests run under Jest to prove
 * that claim end-to-end: the public API, the assertion helpers, and — critically — the
 * cassette auto-save hook from `src/setup/jest.ts`, which Jest registers globally.
 */

// A minimal Vercel-AI-SDK-shaped tool. We avoid importing `ai` so the Jest path stays
// independent of the (ESM-only) SDK; mockist only ever touches `execute`.
function weatherTools(onReal: (city: string) => void) {
  return {
    get_weather: {
      description: "Get the weather for a city",
      execute: async ({ city }: { city: string }, _options?: unknown) => {
        onReal(city);
        return { tempC: 21, city };
      },
    },
  };
}

describe("mockist under jest — public API", () => {
  it("serves a stub and records the call, leaving the real tool untouched", async () => {
    let realCalls = 0;
    const harness = createHarness({
      onUnhandled: "error",
      stubs: defineStubs([{ name: "get_weather", args: { city: "Paris" }, result: { tempC: 9, city: "Paris" } }]),
    });
    const tools = wrapVercelTools(weatherTools(() => realCalls++), harness);

    const out = await tools.get_weather.execute({ city: "Paris" }, {});

    expect(out).toEqual({ tempC: 9, city: "Paris" });
    expect(realCalls).toBe(0);
    expect(expectCalledWith(harness.trajectory, "get_weather", { city: "Paris" }).pass).toBe(true);
    expect(
      expectExactTrajectory(harness.trajectory, [
        { name: "get_weather", input: { city: "Paris" }, output: { tempC: 9, city: "Paris" }, stubbed: true },
      ]).pass,
    ).toBe(true);
  });

  it("passes through to the real tool when no stub matches", async () => {
    let realCity = "";
    const harness = createHarness({ stubs: [] });
    const tools = wrapVercelTools(weatherTools((c) => (realCity = c)), harness);

    const out = await tools.get_weather.execute({ city: "Berlin" }, {});

    expect(out).toEqual({ tempC: 21, city: "Berlin" });
    expect(realCity).toBe("Berlin");
    expect(harness.trajectory[0]).toMatchObject({ name: "get_weather", stubbed: false });
  });

  it("drives a sequence stub without leaving it exhausted", async () => {
    const harness = createHarness({
      stubs: [
        {
          name: "get_weather",
          sequence: [{ error: new Error("timeout") }, { result: { tempC: 5, city: "Oslo" } }],
        },
      ],
    });
    const tools = wrapVercelTools(weatherTools(() => {}), harness);

    await expect(tools.get_weather.execute({ city: "Oslo" }, {})).rejects.toThrow("timeout");
    await expect(tools.get_weather.execute({ city: "Oslo" }, {})).resolves.toEqual({ tempC: 5, city: "Oslo" });
    expect(expectNoExhaustedSequences(harness.sequenceState()).pass).toBe(true);
  });
});

describe("mockist under jest — cassette auto-save via jest-setup", () => {
  const dir = mkdtempSync(join(tmpdir(), "mockist-jest-"));
  const cassettePath = join(dir, "weather.json");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  afterEach(() => {
    delete process.env.MOCKIST_RECORD;
  });

  it("records a real call (flushed by the jest-setup afterEach hook, no manual save)", async () => {
    process.env.MOCKIST_RECORD = "1";
    let realCalls = 0;
    // recording flag is captured at construction, so the pending save is registered now.
    const harness = createHarness({ cassette: cassettePath });
    const tools = wrapVercelTools(weatherTools(() => realCalls++), harness);

    await tools.get_weather.execute({ city: "Paris" }, {});

    expect(realCalls).toBe(1);
    // Intentionally NO harness.save() — the mockist/jest-setup afterEach must flush it.
  });

  it("replays the previously recorded call from the flushed cassette", async () => {
    // If the auto-save hook ran, the cassette now exists on disk with our recorded entry.
    const onDisk = JSON.parse(readFileSync(cassettePath, "utf8"));
    expect(onDisk.calls).toHaveLength(1);

    let realCalls = 0;
    const harness = createHarness({ cassette: cassettePath, onUnhandled: "error" });
    const tools = wrapVercelTools(weatherTools(() => realCalls++), harness);

    const out = await tools.get_weather.execute({ city: "Paris" }, {});

    expect(out).toEqual({ tempC: 21, city: "Paris" });
    expect(realCalls).toBe(0);
    expect(expectExactTrajectory(harness.trajectory, cassetteExpectedCalls(harness)).pass).toBe(true);
    expect(expectCassetteFullyUsed(harness.cassetteState()).pass).toBe(true);
  });
});
