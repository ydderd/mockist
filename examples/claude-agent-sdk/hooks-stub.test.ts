/**
 * CI verification for examples/claude-agent-sdk/integration.ts
 *
 * Uses simulateClaudeToolCall() instead of query() so no API key is needed.
 * The hook inputs/outputs match what @anthropic-ai/claude-agent-sdk sends.
 */
import { expect, test, vi } from "vitest";
import {
  claudeAgentOptionsWithMockist,
  createClaudeHarness,
  createMockistClaudeHooks,
} from "./integration";
import { simulateClaudeToolCall } from "../shared/claude-hook-sim";

test("integration: claudeAgentOptionsWithMockist exposes hooks object", () => {
  const harness = createClaudeHarness();
  const options = claudeAgentOptionsWithMockist(harness);
  expect(options.hooks.PreToolUse).toHaveLength(1);
  expect(options.hooks.PostToolUse).toHaveLength(1);
  expect(options.hooks.PostToolUseFailure).toHaveLength(1);
});

test("integration: stubbed Read — deny + inject updatedToolOutput", async () => {
  const harness = createClaudeHarness();
  const hooks = createMockistClaudeHooks(harness);

  const { output, denied } = await simulateClaudeToolCall(
    hooks,
    "Read",
    { file_path: "/tmp/x" },
    "toolu_01",
  );

  expect(denied).toBe(true);
  expect(output).toEqual({ content: "stubbed file" });
  expect(harness.trajectory[0]).toMatchObject({
    kind: "tool",
    name: "Read",
    input: { file_path: "/tmp/x" },
    stubbed: true,
  });
});

test("integration: passthrough Read — allow + PostToolUse records live output", async () => {
  const harness = createClaudeHarness({ stubs: [] });
  const hooks = createMockistClaudeHooks(harness);
  const realRead = vi.fn(async () => ({ content: "live file bytes" }));

  const { denied } = await simulateClaudeToolCall(
    hooks,
    "Read",
    { file_path: "/etc/hosts" },
    "toolu_02",
    realRead,
  );

  expect(denied).toBe(false);
  expect(realRead).toHaveBeenCalledOnce();
  expect(harness.trajectory[0]).toMatchObject({
    stubbed: false,
    output: { content: "live file bytes" },
  });
});

test("integration: researcher sub-agent recorded as kind subagent", async () => {
  const harness = createClaudeHarness();
  const hooks = createMockistClaudeHooks(harness);

  await simulateClaudeToolCall(
    hooks,
    "researcher",
    { task: "find billing docs" },
    "toolu_03",
  );

  expect(harness.trajectory[0]).toMatchObject({
    kind: "subagent",
    name: "researcher",
    stubbed: true,
  });
});

test("integration: Bash stub error recorded on trajectory", async () => {
  const harness = createClaudeHarness();
  const hooks = createMockistClaudeHooks(harness);

  await simulateClaudeToolCall(hooks, "Bash", { command: "rm -rf /" }, "toolu_04");

  expect(harness.trajectory[0]).toMatchObject({ name: "Bash", stubbed: true });
  expect(harness.trajectory[0]!.error).toBeInstanceOf(Error);
});
