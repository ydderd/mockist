import { expect, test, vi } from "vitest";
import { createHarness } from "../src/core/harness";
import { wrapMcpToolHandler, wrapMcpHandlers, createMcpClientInterceptor } from "../src/adapters/mcp";

test("wrapMcpToolHandler stubs without calling real handler", async () => {
  const real = vi.fn(async () => ({ content: [{ type: "text", text: "real" }] }));
  const harness = createHarness({ stubs: [{ name: "search", args: { q: "mockist" }, result: { hits: 1 } }] });
  const wrapped = wrapMcpToolHandler(harness, "search", real);
  expect(await wrapped({ arguments: { q: "mockist" } })).toEqual({ hits: 1 });
  expect(real).not.toHaveBeenCalled();
});

test("wrapMcpHandlers wraps every handler in the map", async () => {
  const a = vi.fn(async () => "a");
  const harness = createHarness({ stubs: [{ name: "b", result: "stub-b" }] });
  const wrapped = wrapMcpHandlers({ a, b: async (_args) => "b" }, harness);
  expect(await wrapped.b({ arguments: {} })).toBe("stub-b");
  expect(a).not.toHaveBeenCalled();
});

test("createMcpClientInterceptor routes client callTool through harness", async () => {
  const real = vi.fn(async (_name: string, args: unknown) => ({ args }));
  const harness = createHarness({ stubs: [{ name: "fetch", result: { ok: true } }] });
  const call = createMcpClientInterceptor(harness, real);
  expect(await call("fetch", { url: "x" })).toEqual({ ok: true });
  expect(real).not.toHaveBeenCalled();
});
