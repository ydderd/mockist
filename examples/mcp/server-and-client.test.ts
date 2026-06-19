/**
 * CI verification for examples/mcp/integration.ts
 */
import { expect, test, vi } from "vitest";
import {
  createMcpHarness,
  createMcpToolHandlers,
  dispatchMcpToolCall,
  wireMcpClient,
  wireMcpServer,
  wireSingleMcpTool,
} from "./integration";

test("integration: wireMcpServer stubs search, passthrough ping", async () => {
  const { handlers, harness } = wireMcpServer();

  const stubbed = await dispatchMcpToolCall(handlers, "search", { q: "mockist" });
  expect(stubbed).toEqual({ content: [{ type: "text", text: "hit-1" }] });

  const live = await dispatchMcpToolCall(handlers, "ping", {});
  expect(live).toEqual({ content: [{ type: "text", text: "pong" }] });

  expect(harness.trajectory.map((c) => ({ name: c.name, stubbed: c.stubbed }))).toEqual([
    { name: "search", stubbed: true },
    { name: "ping", stubbed: false },
  ]);
});

test("integration: wireSingleMcpTool wraps one handler", async () => {
  const harness = createMcpHarness();
  const real = vi.fn(async () => ({ content: [{ type: "text", text: "light" }] }));
  const getConfig = wireSingleMcpTool(harness, "get_config", real);

  const out = await getConfig({ arguments: {} });
  expect(out).toEqual({ content: [{ type: "text", text: '{"theme":"dark"}' }] });
  expect(real).not.toHaveBeenCalled();
});

test("integration: wireMcpClient intercepts remote callTool", async () => {
  const harness = createMcpHarness();
  const remote = vi.fn(async (name: string, args: unknown) => ({ name, args, live: true }));
  const callTool = wireMcpClient(harness, remote);

  const out = await callTool("mcp__memory__read", { key: "prefs" });
  expect(out).toEqual({ entries: [] });
  expect(remote).not.toHaveBeenCalled();
});

test("integration: real handlers unchanged when using wireMcpServer", () => {
  const real = createMcpToolHandlers();
  expect(Object.keys(real).sort()).toEqual(["get_config", "ping", "search"]);
});
