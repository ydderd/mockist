import { expect, test, vi } from "vitest";
import { createHarness } from "../src/core/harness";
import { wrapVercelTools } from "../src/adapters/vercel";

test("stubbed tool returns the canned value; real execute not called", async () => {
  const realExecute = vi.fn(async ({ city }: { city: string }) => ({ tempC: 99, city }));
  const harness = createHarness({ stubs: [{ name: "weather", args: { city: "Paris" }, result: { tempC: 21 } }] });
  const wrapped = wrapVercelTools({ weather: { description: "w", execute: realExecute } }, harness);
  expect(await wrapped.weather.execute!({ city: "Paris" }, {} as any)).toEqual({ tempC: 21 });
  expect(realExecute).not.toHaveBeenCalled();
  expect(harness.trajectory[0]).toMatchObject({ kind: "tool", name: "weather", stubbed: true });
});

test("unstubbed tool passes through to real execute", async () => {
  const realExecute = vi.fn(async ({ city }: { city: string }) => ({ tempC: 99, city }));
  const harness = createHarness({ stubs: [{ name: "weather", args: { city: "Paris" }, result: { tempC: 21 } }] });
  const wrapped = wrapVercelTools({ weather: { description: "w", execute: realExecute } }, harness);
  expect(await wrapped.weather.execute!({ city: "Berlin" }, {} as any)).toEqual({ tempC: 99, city: "Berlin" });
  expect(realExecute).toHaveBeenCalledTimes(1);
  expect(harness.trajectory[0]).toMatchObject({ name: "weather", stubbed: false });
});

test("tools without an execute are passed through untouched", () => {
  const clientTool = { description: "no execute" };
  const wrapped = wrapVercelTools({ ui: clientTool }, createHarness());
  expect(wrapped.ui).toBe(clientTool);
});

test("non-execute properties are preserved", () => {
  const wrapped = wrapVercelTools(
    { weather: { description: "desc", inputSchema: { marker: true }, execute: async () => 1 } },
    createHarness(),
  );
  expect(wrapped.weather.description).toBe("desc");
  expect((wrapped.weather as any).inputSchema).toEqual({ marker: true });
});
