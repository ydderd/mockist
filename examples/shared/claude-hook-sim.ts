/**
 * Simulate one Claude Agent SDK tool invocation through mockist hooks.
 *
 * This mirrors the SDK's hook sequence without calling query() or needing an API key.
 * Use in tests and as a reference for what happens at each step.
 *
 * Lifecycle (stubbed):
 *   1. PreToolUse      → mockist denies (permissionDecision: "deny")
 *   2. PostToolUseFailure → mockist injects updatedToolOutput from stub
 *
 * Lifecycle (passthrough):
 *   1. PreToolUse      → mockist allows (permissionDecision: "allow")
 *   2. realExecute()   → your tool runs (or SDK runs built-in tool)
 *   3. PostToolUse     → mockist records tool_response
 */

import type { ClaudeAgentHooks } from "../../src/adapters/claude";

export interface SimulatedClaudeCall {
  toolName: string;
  input: unknown;
  toolUseId: string;
  output: unknown;
  /** true when PreToolUse returned deny (stub path) */
  denied: boolean;
}

export async function simulateClaudeToolCall(
  hooks: ClaudeAgentHooks,
  toolName: string,
  input: unknown,
  toolUseId: string,
  realExecute?: () => Promise<unknown>,
): Promise<SimulatedClaudeCall> {
  const signal = AbortSignal.timeout(5_000);

  // --- Step 1: PreToolUse (SDK fires before tool runs) ----------------------
  const pre = hooks.PreToolUse[0]!.hooks[0]!;
  const preOut = await pre(
    {
      hook_event_name: "PreToolUse",
      tool_name: toolName,
      tool_input: input,
      tool_use_id: toolUseId,
    },
    toolUseId,
    { signal },
  );

  if (preOut.hookSpecificOutput?.permissionDecision === "deny") {
    // --- Step 2b: PostToolUseFailure (stub injection) -----------------------
    const fail = hooks.PostToolUseFailure[0]!.hooks[0]!;
    const failOut = await fail(
      {
        hook_event_name: "PostToolUseFailure",
        tool_name: toolName,
        tool_input: input,
        tool_use_id: toolUseId,
        error_message: "denied by mockist stub",
      },
      toolUseId,
      { signal },
    );
    const raw = failOut.hookSpecificOutput?.updatedToolOutput ?? "";
    let output: unknown = raw;
    try {
      output = JSON.parse(raw);
    } catch {
      // plain string tool output (e.g. Grep results)
    }
    return { toolName, input, toolUseId, output, denied: true };
  }

  // --- Step 2a: real tool (passthrough) -------------------------------------
  const output = realExecute ? await realExecute() : { ok: true };

  // --- Step 3: PostToolUse (record what the model sees) ---------------------
  const post = hooks.PostToolUse[0]!.hooks[0]!;
  await post(
    {
      hook_event_name: "PostToolUse",
      tool_name: toolName,
      tool_input: input,
      tool_response: output,
      tool_use_id: toolUseId,
    },
    toolUseId,
    { signal },
  );

  return { toolName, input, toolUseId, output, denied: false };
}
