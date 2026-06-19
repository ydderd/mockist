import { expect, test, vi } from "vitest";
import { createHarness } from "../src/core/harness";
import { createClaudeAgentHooks, type PreToolUseHookInput } from "../src/adapters/claude";

const abort = new AbortController().signal;

function preHook(hooks: ReturnType<typeof createClaudeAgentHooks>) {
  return hooks.PreToolUse[0]!.hooks[0]!;
}

function postFailureHook(hooks: ReturnType<typeof createClaudeAgentHooks>) {
  return hooks.PostToolUseFailure[0]!.hooks[0]!;
}

test("stubbed Claude tool: PreToolUse denies and PostToolUseFailure injects output", async () => {
  const harness = createHarness({ stubs: [{ name: "weather", args: { city: "Paris" }, result: { tempC: 21 } }] });
  const hooks = createClaudeAgentHooks(harness);
  const pre = preHook(hooks);
  const postFail = postFailureHook(hooks);

  const preInput: PreToolUseHookInput = {
    hook_event_name: "PreToolUse",
    tool_name: "weather",
    tool_input: { city: "Paris" },
    tool_use_id: "tu-1",
  };
  const preOut = await pre(preInput, "tu-1", { signal: abort });
  expect(preOut.hookSpecificOutput?.permissionDecision).toBe("deny");

  const failOut = await postFail(
    {
      hook_event_name: "PostToolUseFailure",
      tool_name: "weather",
      tool_input: { city: "Paris" },
      tool_use_id: "tu-1",
      error_message: "denied",
    },
    "tu-1",
    { signal: abort },
  );
  expect(failOut.hookSpecificOutput?.updatedToolOutput).toBe(JSON.stringify({ tempC: 21 }));
  expect(harness.trajectory).toHaveLength(1);
  expect(harness.trajectory[0]).toMatchObject({ kind: "tool", name: "weather", stubbed: true, output: { tempC: 21 } });
});

test("subagent tool names map to kind subagent", async () => {
  const harness = createHarness({ stubs: [{ name: "researcher", result: { ok: true } }] });
  const hooks = createClaudeAgentHooks(harness, { subagentNames: ["researcher"] });
  const pre = preHook(hooks);
  const postFail = postFailureHook(hooks);

  await pre(
    { hook_event_name: "PreToolUse", tool_name: "researcher", tool_input: { task: "x" }, tool_use_id: "tu-2" },
    "tu-2",
    { signal: abort },
  );
  await postFail(
    {
      hook_event_name: "PostToolUseFailure",
      tool_name: "researcher",
      tool_input: { task: "x" },
      tool_use_id: "tu-2",
    },
    "tu-2",
    { signal: abort },
  );
  expect(harness.trajectory[0]).toMatchObject({ kind: "subagent", name: "researcher" });
});

test("unstubbed Claude tool: PreToolUse allows passthrough", async () => {
  const harness = createHarness({ stubs: [{ name: "other", result: 1 }] });
  const hooks = createClaudeAgentHooks(harness);
  const pre = preHook(hooks);
  const out = await pre(
    { hook_event_name: "PreToolUse", tool_name: "weather", tool_input: { city: "Berlin" }, tool_use_id: "tu-3" },
    "tu-3",
    { signal: abort },
  );
  expect(out.hookSpecificOutput?.permissionDecision).toBe("allow");
  expect(harness.trajectory).toHaveLength(0);
});

test("PostToolUse records passthrough tool_response", async () => {
  const harness = createHarness();
  const hooks = createClaudeAgentHooks(harness);
  const post = hooks.PostToolUse[0]!.hooks[0]!;
  await post(
    {
      hook_event_name: "PostToolUse",
      tool_name: "weather",
      tool_input: { city: "Berlin" },
      tool_response: { tempC: 5 },
      tool_use_id: "tu-4",
    },
    "tu-4",
    { signal: abort },
  );
  expect(harness.trajectory[0]).toMatchObject({ stubbed: false, output: { tempC: 5 } });
});

test("stub correlates via callback toolUseId when input omits tool_use_id", async () => {
  const harness = createHarness({ stubs: [{ name: "weather", result: { tempC: 21 } }] });
  const hooks = createClaudeAgentHooks(harness);
  const pre = preHook(hooks);
  const postFail = postFailureHook(hooks);

  await pre(
    { hook_event_name: "PreToolUse", tool_name: "weather", tool_input: { city: "Paris" } },
    "tu-callback",
    { signal: abort },
  );
  const failOut = await postFail(
    {
      hook_event_name: "PostToolUseFailure",
      tool_name: "weather",
      tool_input: { city: "Paris" },
    },
    "tu-callback",
    { signal: abort },
  );
  expect(failOut.hookSpecificOutput?.updatedToolOutput).toBe(JSON.stringify({ tempC: 21 }));
  expect(harness.trajectory).toHaveLength(1);
});

test("PostToolUse skips recording when stub is pending (deny path)", async () => {
  const harness = createHarness({ stubs: [{ name: "weather", result: { ok: true } }] });
  const hooks = createClaudeAgentHooks(harness);
  const pre = preHook(hooks);
  const post = hooks.PostToolUse[0]!.hooks[0]!;

  await pre(
    { hook_event_name: "PreToolUse", tool_name: "weather", tool_input: {}, tool_use_id: "tu-dup" },
    "tu-dup",
    { signal: abort },
  );
  await post(
    {
      hook_event_name: "PostToolUse",
      tool_name: "weather",
      tool_input: {},
      tool_response: { should: "not-record" },
      tool_use_id: "tu-dup",
    },
    "tu-dup",
    { signal: abort },
  );
  expect(harness.trajectory).toHaveLength(0);
});
