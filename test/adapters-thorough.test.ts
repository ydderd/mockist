import { expect, test, vi } from "vitest";
import { createHarness } from "../src/core/harness";
import { createClaudeAgentHooks } from "../src/adapters/claude";
import { wrapMcpToolHandler, wrapMcpHandlers, createMcpClientInterceptor } from "../src/adapters/mcp";
import { wrapOpenAiTools, createOpenAiToolInterceptor } from "../src/adapters/openai";
import { simulateClaudeToolCall } from "../examples/shared/claude-hook-sim";

// --- Claude -----------------------------------------------------------------

test("Claude: skill kind mapping", async () => {
  const harness = createHarness({ stubs: [{ name: "send_email", result: { sent: true } }] });
  const hooks = createClaudeAgentHooks(harness, { skillNames: ["send_email"] });
  await simulateClaudeToolCall(hooks, "send_email", { to: "a@b.c" }, "tu-skill");
  expect(harness.trajectory[0]).toMatchObject({ kind: "skill", name: "send_email" });
});

test("Claude: sequence passthrough allows real execution in PreToolUse", async () => {
  const harness = createHarness({
    stubs: [{
      name: "poll",
      sequence: [{ result: "first" }],
      onSequenceExhausted: "passthrough",
    }],
  });
  const hooks = createClaudeAgentHooks(harness);
  const signal = AbortSignal.timeout(5_000);
  const pre = hooks.PreToolUse[0]!.hooks[0]!;

  await pre(
    { hook_event_name: "PreToolUse", tool_name: "poll", tool_input: {}, tool_use_id: "tu-seq-1" },
    "tu-seq-1",
    { signal },
  );
  const second = await pre(
    { hook_event_name: "PreToolUse", tool_name: "poll", tool_input: {}, tool_use_id: "tu-seq-2" },
    "tu-seq-2",
    { signal },
  );
  expect(second.hookSpecificOutput?.permissionDecision).toBe("allow");
});

test("Claude: onUnhandled error in resolveCall throws before deny", async () => {
  const harness = createHarness({ onUnhandled: "error" });
  const hooks = createClaudeAgentHooks(harness);
  const pre = hooks.PreToolUse[0]!.hooks[0]!;
  await expect(
    pre(
      { hook_event_name: "PreToolUse", tool_name: "unknown", tool_input: {}, tool_use_id: "tu-err" },
      "tu-err",
      { signal: AbortSignal.timeout(5_000) },
    ),
  ).rejects.toThrow(/unhandled/);
});

test("Claude: string tool output serializes without JSON wrap", async () => {
  const harness = createHarness({ stubs: [{ name: "Grep", result: "line1\nline2" }] });
  const hooks = createClaudeAgentHooks(harness);
  const { output } = await simulateClaudeToolCall(hooks, "Grep", { pattern: "x" }, "tu-str");
  expect(output).toBe("line1\nline2");
});

test("Claude: hooks structure matches SDK shape", () => {
  const hooks = createClaudeAgentHooks(createHarness());
  expect(hooks.PreToolUse[0]?.matcher).toBeNull();
  expect(hooks.PostToolUse[0]?.hooks).toHaveLength(1);
  expect(hooks.PostToolUseFailure[0]?.hooks).toHaveLength(1);
});

// --- MCP --------------------------------------------------------------------

test("MCP: stub error propagates and records on trajectory", async () => {
  const harness = createHarness({
    stubs: [{ name: "write", result: () => { throw new Error("disk full"); } }],
  });
  const handler = wrapMcpToolHandler(harness, "write", async () => ({ ok: true }));
  await expect(handler({ arguments: { path: "/x" } })).rejects.toThrow("disk full");
  expect(harness.trajectory[0]).toMatchObject({ name: "write", stubbed: true });
});

test("MCP: client interceptor passthrough calls remote", async () => {
  const harness = createHarness({ stubs: [{ name: "a", result: 1 }] });
  const remote = vi.fn(async () => "remote");
  const call = createMcpClientInterceptor(harness, remote);
  expect(await call("b", {})).toBe("remote");
  expect(remote).toHaveBeenCalledWith("b", {});
  expect(harness.trajectory[0]).toMatchObject({ name: "b", stubbed: false });
});

test("MCP: wrapMcpHandlers preserves handler map keys", () => {
  const harness = createHarness();
  const wrapped = wrapMcpHandlers({ alpha: async () => 1, beta: async () => 2 }, harness);
  expect(Object.keys(wrapped).sort()).toEqual(["alpha", "beta"]);
});

// --- OpenAI -----------------------------------------------------------------

test("OpenAI: tools without execute are returned unchanged", () => {
  const schemaOnly = { type: "function", function: { name: "x" } };
  const harness = createHarness();
  const wrapped = wrapOpenAiTools({ x: schemaOnly }, harness);
  expect(wrapped.x).toBe(schemaOnly);
});

test("OpenAI: passthrough records stubbed false", async () => {
  const harness = createHarness({ stubs: [{ name: "t", args: { a: 1 }, result: "stub" }] });
  const real = vi.fn(async (_input: unknown) => "live");
  const tools = wrapOpenAiTools({ t: { execute: real } }, harness);
  await tools.t!.execute!({ a: 2 });
  expect(real).toHaveBeenCalledTimes(1);
  expect(harness.trajectory[0]).toMatchObject({ stubbed: false, output: "live" });
});

test("OpenAI: interceptor records trajectory on stub hit", async () => {
  const harness = createHarness({ stubs: [{ name: "ping", result: "pong" }] });
  const run = createOpenAiToolInterceptor(harness, async () => "live");
  expect(await run("ping", {})).toBe("pong");
  expect(harness.trajectory).toHaveLength(1);
});

test("OpenAI: non-execute properties preserved on wrapped tools", () => {
  const harness = createHarness();
  const wrapped = wrapOpenAiTools(
    { weather: { description: "w", parameters: { type: "object" }, execute: async () => 1 } },
    harness,
  );
  expect(wrapped.weather.description).toBe("w");
  expect((wrapped.weather as { parameters: unknown }).parameters).toEqual({ type: "object" });
});

// --- Cross-adapter parity ---------------------------------------------------

test("all execute-style adapters block real handler when stubbed", async () => {
  const stubs = [{ name: "tool", result: { ok: true } }];
  const real = vi.fn(async (_input?: unknown) => ({ ok: false }));

  const vercelHarness = createHarness({ stubs });
  const { wrapVercelTools } = await import("../src/adapters/vercel");
  await wrapVercelTools({ tool: { execute: real } }, vercelHarness).tool.execute!({});
  expect(real).not.toHaveBeenCalled();

  real.mockClear();
  const openaiHarness = createHarness({ stubs });
  await wrapOpenAiTools({ tool: { execute: real } }, openaiHarness).tool!.execute!({});
  expect(real).not.toHaveBeenCalled();

  real.mockClear();
  const mcpHarness = createHarness({ stubs });
  await wrapMcpToolHandler(mcpHarness, "tool", async () => real())({ arguments: {} });
  expect(real).not.toHaveBeenCalled();
});
