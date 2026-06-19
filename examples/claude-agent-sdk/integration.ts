/**
 * Claude Agent SDK integration with mockist
 * =========================================
 *
 * Install:  npm install mockist @anthropic-ai/claude-agent-sdk
 * In-repo:  swap ../../src/index → "mockist"
 *
 * Claude routes every tool, skill, and sub-agent through the same hook surface:
 * PreToolUse → (optional deny) → tool runs → PostToolUse / PostToolUseFailure.
 *
 * mockist hooks into that pipeline:
 *
 *   STUBBED call
 *   ------------
 *   PreToolUse     harness.resolveCall() finds a stub
 *                  → permissionDecision: "deny" (real tool never runs)
 *   PostToolUseFailure
 *                  → updatedToolOutput: <stub JSON> (model sees canned result)
 *                  → harness.captureCall(..., { stubbed: true })
 *
 *   PASSTHROUGH call
 *   ----------------
 *   PreToolUse     no stub match → permissionDecision: "allow"
 *   (SDK runs real tool)
 *   PostToolUse    harness.captureCall(..., { stubbed: false, output: tool_response })
 *
 * PRODUCTION WIRING
 * -----------------
 * ```ts
 * import { query } from "@anthropic-ai/claude-agent-sdk";
 * import { createHarness, createClaudeAgentHooks } from "mockist";
 *
 * const harness = createHarness({ stubs: [...] });
 * const mockist = createClaudeAgentHooks(harness, {
 *   subagentNames: ["researcher"],   // recorded as kind: "subagent"
 *   skillNames: ["send_email"],      // recorded as kind: "skill"
 * });
 *
 * for await (const message of query({
 *   prompt: "Read /tmp/config and summarize",
 *   options: {
 *     hooks: mergeClaudeHooks(mockist, {
 *       // your own security hooks still run alongside mockist
 *       PreToolUse: [{ matcher: "Bash", hooks: [blockRmRf] }],
 *     }),
 *   },
 * })) {
 *   // ... consume stream
 * }
 *
 * expect(harness.trajectory.map(c => c.name)).toEqual(["Read", "Grep"]);
 * ```
 */

import {
  createClaudeAgentHooks,
  createHarness,
  defineStubs,
  type ClaudeAgentHooks,
  type Harness,
} from "../../src/index";

// ---------------------------------------------------------------------------
// 1. Stubs — same declarative format as every other adapter
// ---------------------------------------------------------------------------

export const CLAUDE_SUITE_STUBS = defineStubs([
  { name: "Read", args: { file_path: "/tmp/x" }, result: { content: "stubbed file" } },
  // kind must match what createClaudeAgentHooks records (subagentNames / skillNames)
  { kind: "subagent", name: "researcher", result: { findings: ["doc-a", "doc-b"] } },
  { name: "Bash", result: () => { throw new Error("command blocked"); } },
]);

export function createClaudeHarness(overrides?: Parameters<typeof createHarness>[0]) {
  return createHarness({ stubs: [...CLAUDE_SUITE_STUBS], onUnhandled: "passthrough", ...overrides });
}

// ---------------------------------------------------------------------------
// 2. Create mockist hooks — pass skill/subagent tool names for CallKind tagging
// ---------------------------------------------------------------------------

export function createMockistClaudeHooks(
  harness: Harness,
  opts?: { skillNames?: string[]; subagentNames?: string[] },
): ClaudeAgentHooks {
  return createClaudeAgentHooks(harness, {
    skillNames: opts?.skillNames ?? ["send_email"],
    subagentNames: opts?.subagentNames ?? ["researcher"],
  });
}

// NOTE: when tagging subagentNames/skillNames, add matching `kind` on stubs:
//   { kind: "subagent", name: "researcher", result: ... }
//   { kind: "skill", name: "send_email", result: ... }

// ---------------------------------------------------------------------------
// 3. Merge with your own hooks (mockist hooks run first in each array)
// ---------------------------------------------------------------------------

type HookBucket = ClaudeAgentHooks[keyof ClaudeAgentHooks];

export function mergeClaudeHooks(
  mockist: ClaudeAgentHooks,
  yours: Partial<Record<keyof ClaudeAgentHooks, HookBucket>>,
): ClaudeAgentHooks {
  return {
    PreToolUse: [...mockist.PreToolUse, ...(yours.PreToolUse ?? [])],
    PostToolUse: [...mockist.PostToolUse, ...(yours.PostToolUse ?? [])],
    PostToolUseFailure: [...mockist.PostToolUseFailure, ...(yours.PostToolUseFailure ?? [])],
  };
}

// ---------------------------------------------------------------------------
// 4. Options object you'd pass to query() — ready to spread into ClaudeAgentOptions
// ---------------------------------------------------------------------------

export function claudeAgentOptionsWithMockist(harness: Harness) {
  const mockistHooks = createMockistClaudeHooks(harness);
  return {
    hooks: mergeClaudeHooks(mockistHooks, {
      // Example: your own PreToolUse hook still runs after mockist's
      // PreToolUse: [{ matcher: "Write|Edit", hooks: [auditLog] }],
    }),
  };
}
