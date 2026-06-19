import type { CallKind } from "../core/types";
import type { Harness } from "../core/harness";

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

  const preToolUse: ClaudeHookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const { tool_name, tool_input, tool_use_id: toolUseId } = input;
    const kind = kindForTool(tool_name, skillNames, subagentNames);
    const resolved = await harness.resolveCall(kind, tool_name, tool_input);

    if (resolved.matched) {
      if ("passthrough" in resolved) {
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            permissionDecisionReason: "mockist: sequence passthrough",
          },
        };
      }
      const key = toolUseId ?? `${tool_name}:${Date.now()}`;
      if ("error" in resolved) {
        pending.set(key, { kind, name: tool_name, input: tool_input, error: resolved.error });
      } else {
        pending.set(key, { kind, name: tool_name, input: tool_input, output: resolved.output });
      }
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "mockist: stubbed tool call",
        },
      };
    }

    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    };
  };

  const postToolUse: ClaudeHookCallback = async (input) => {
    if (input.hook_event_name !== "PostToolUse") return {};
    const { tool_name, tool_input, tool_response } = input;
    const kind = kindForTool(tool_name, skillNames, subagentNames);
    harness.recordCall(kind, tool_name, tool_input, { stubbed: false, output: tool_response });
    return {};
  };

  const postToolUseFailure: ClaudeHookCallback = async (input) => {
    if (input.hook_event_name !== "PostToolUseFailure") return {};
    const { tool_name, tool_input, tool_use_id: toolUseId } = input;
    const key = toolUseId ?? "";
    const stub = key ? pending.get(key) : undefined;
    if (stub) {
      pending.delete(key);
      if (stub.error !== undefined) {
        harness.recordCall(stub.kind, stub.name, stub.input, { stubbed: true, error: stub.error });
        return {
          hookSpecificOutput: {
            hookEventName: "PostToolUseFailure",
            updatedToolOutput: serializeToolOutput({ error: String(stub.error) }),
          },
        };
      }
      harness.recordCall(stub.kind, stub.name, stub.input, { stubbed: true, output: stub.output });
      return {
        hookSpecificOutput: {
          hookEventName: "PostToolUseFailure",
          updatedToolOutput: serializeToolOutput(stub.output),
        },
      };
    }

    // Non-mockist denial — still record if this looks like a real failure path.
    const kind = kindForTool(tool_name, skillNames, subagentNames);
    harness.recordCall(kind, tool_name, tool_input, {
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
