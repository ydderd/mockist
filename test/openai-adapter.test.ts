import { expect, test, vi } from "vitest";
import { createHarness } from "../src/core/harness";
import { wrapOpenAiTools, createOpenAiToolInterceptor } from "../src/adapters/openai";

test("wrapOpenAiTools stubs execute like wrapVercelTools", async () => {
  const realExecute = vi.fn(async ({ city }: { city: string }) => ({ tempC: 99, city }));
  const harness = createHarness({ stubs: [{ name: "get_weather", args: { city: "Paris" }, result: { tempC: 21 } }] });
  const wrapped = wrapOpenAiTools(
    { get_weather: { type: "function", execute: realExecute as (input: unknown) => Promise<unknown> } },
    harness,
  );
  expect(await wrapped.get_weather!.execute!({ city: "Paris" })).toEqual({ tempC: 21 });
  expect(realExecute).not.toHaveBeenCalled();
});

test("createOpenAiToolInterceptor routes runTool through harness", async () => {
  const real = vi.fn(async () => "live");
  const harness = createHarness({ stubs: [{ name: "calc", result: 42 }] });
  const run = createOpenAiToolInterceptor(harness, real);
  expect(await run("calc", { x: 1 })).toBe(42);
  expect(real).not.toHaveBeenCalled();
});
