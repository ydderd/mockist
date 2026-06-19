import type { CallKind } from "../core/types";
import type { Harness } from "../core/harness";
import { identify } from "../core/identity";

/** Structural subset of Claude Agent SDK PreToolUse hook input. */
export interface PreToolUseHookInput {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: unknown;
  tool_use_id?: string;
  agent_id?: string;
  agent_type?: string;
}

/** Structural subset of PostToolUse hook input. */
export interface PostToolUseHookInput {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
  tool_use_id?: string;
}

/** Structural subset of PostToolUseFailure hook input. */
export interface PostToolUseFailureHookInput {
  hook_event_name: "PostToolUseFailure";
  tool_name: string;
  tool_input: unknown;
  error_message?: string;
  tool_use_id?: string;
}

export type ClaudeHookInput = PreToolUseHookInput | PostToolUseHookInput | PostToolUseFailureHookInput;

export interface ClaudeAgentHooks {
  PreToolUse: Array<{ matcher: string | null; hooks: ClaudeHookCallback[] }>;
  PostToolUse: Array<{ matcher: string | null; hooks: ClaudeHookCallback[] }>;
  PostToolUseFailure: Array<{ matcher: string | null; hooks: ClaudeHookCallback[] }>;
}

export type ClaudeHookCallback = (
  input: ClaudeHookInput,
  toolUseId: string | undefined,
  context: { signal: AbortSignal },
) => Promise<ClaudeHookOutput>;

export interface ClaudeHookOutput {
  hookSpecificOutput?: {
    hookEventName: string;
    permissionDecision?: "allow" | "deny" | "ask" | "defer";
    permissionDecisionReason?: string;
    updatedInput?: unknown;
    updatedToolOutput?: string;
    additionalContext?: string;
  };
}

export interface ClaudeAgentHooksOptions {
  /** Tool names recorded as `kind: "skill"`. */
  skillNames?: Iterable<string>;
  /** Tool names recorded as `kind: "subagent"`. */
  subagentNames?: Iterable<string>;
}

interface PendingStub {
  kind: CallKind;
  name: string;
  input: unknown;
  output?: unknown;
  error?: unknown;
}

function serializeToolOutput(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function kindForTool(
  name: string,
  skillNames: ReadonlySet<string>,
  subagentNames: ReadonlySet<string>,
): CallKind {
  if (subagentNames.has(name)) return "subagent";
  if (skillNames.has(name)) return "skill";
  return "tool";
}

/** Correlate PreToolUse deny with PostToolUseFailure across hook callbacks. */
function correlationKey(
  kind: CallKind,
  name: string,
  input: unknown,
  toolUseId?: string,
): string {
  return toolUseId || identify(kind, name, input);
}

/**
 * Claude Agent SDK hooks that route every tool/skill/sub-agent call through the harness.
 *
 * Stubbed calls: PreToolUse denies execution; PostToolUseFailure injects
 * `updatedToolOutput`. Passthrough calls: PreToolUse allows; PostToolUse records the
 * real `tool_response`.
 */
export function createClaudeAgentHooks(
  harness: Harness,
  opts: ClaudeAgentHooksOptions = {},
): ClaudeAgentHooks {
  const skillNames = new Set(opts.skillNames);
  const subagentNames = new Set(opts.subagentNames);
  const pending = new Map<string, PendingStub>();

  const preToolUse: ClaudeHookCallback = async (input, toolUseId) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const { tool_name, tool_input } = input;
    const kind = kindForTool(tool_name, skillNames, subagentNames);
    const key = correlationKey(kind, tool_name, tool_input, toolUseId ?? input.tool_use_id);
    const resolved = await harness.resolveCall(kind, tool_name, tool_input);

    if (resolved.matched) {
      if ("passthrough" in resolved) {
        pending.delete(key);
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            permissionDecisionReason: "mockist: sequence passthrough",
          },
        };
      }
      try {
        const output = await resolved.produce();
        harness.captureCall(kind, tool_name, tool_input, { stubbed: true, output });
        pending.set(key, { kind, name: tool_name, input: tool_input, output });
      } catch (error) {
        harness.captureCall(kind, tool_name, tool_input, { stubbed: true, error });
        pending.set(key, { kind, name: tool_name, input: tool_input, error });
      }
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "mockist: stubbed tool call",
        },
      };
    }

    pending.delete(key);
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    };
  };

  const postToolUse: ClaudeHookCallback = async (input, toolUseId) => {
    if (input.hook_event_name !== "PostToolUse") return {};
    const { tool_name, tool_input, tool_response } = input;
    const kind = kindForTool(tool_name, skillNames, subagentNames);
    const key = correlationKey(kind, tool_name, tool_input, toolUseId ?? input.tool_use_id);
    // Stubbed calls were denied in PreToolUse — PostToolUseFailure owns recording.
    if (pending.has(key)) return {};
    harness.captureCall(kind, tool_name, tool_input, { stubbed: false, output: tool_response });
    return {};
  };

  const postToolUseFailure: ClaudeHookCallback = async (input, toolUseId) => {
    if (input.hook_event_name !== "PostToolUseFailure") return {};
    const { tool_name, tool_input } = input;
    const kind = kindForTool(tool_name, skillNames, subagentNames);
    const key = correlationKey(kind, tool_name, tool_input, toolUseId ?? input.tool_use_id);
    const stub = pending.get(key);
    if (stub) {
      pending.delete(key);
      if (stub.error !== undefined) {
        return {
          hookSpecificOutput: {
            hookEventName: "PostToolUseFailure",
            updatedToolOutput: serializeToolOutput({ error: String(stub.error) }),
          },
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: "PostToolUseFailure",
          updatedToolOutput: serializeToolOutput(stub.output),
        },
      };
    }

    // Non-mockist denial — still record if this looks like a real failure path.
    harness.captureCall(kind, tool_name, tool_input, {
      stubbed: false,
      error: input.error_message ?? "tool failed",
    });
    return {};
  };

  const allTools = { matcher: null as string | null, hooks: [preToolUse] };
  return {
    PreToolUse: [allTools],
    PostToolUse: [{ matcher: null, hooks: [postToolUse] }],
    PostToolUseFailure: [{ matcher: null, hooks: [postToolUseFailure] }],
  };
}
