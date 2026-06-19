# SDK adapters (Claude Agent SDK, MCP, OpenAI) — design

Status: approved design, implementation in progress. Roadmap: M2 item 4 (next gate).
Authority: [`docs/BACKLOG.md`](../../BACKLOG.md).

## Goal

Prove the harness/recorder model generalizes beyond the Vercel AI SDK by adding thin
adapters that route each SDK's tool/skill boundary into the same `Harness.dispatch` /
trajectory / cassette stack.

## Principles

- **Stay at the boundary.** Adapters intercept tool/skill invocations; they do not reach
  inside `execute` or dependency I/O.
- **Thin wrappers.** Normalize names and args, delegate to `Harness`; no SDK-specific stub
  format.
- **Structural types.** Avoid hard peer-deps on every SDK where possible; use local
  structural types and optional peer deps for consumers who install the SDK.
- **Same trajectory model.** `Call.kind` is `"tool" | "skill" | "subagent"`; adapters map
  SDK-specific surfaces to these kinds.

## Claude Agent SDK — `createClaudeAgentHooks(harness)`

Tools, skills, and sub-agents all flow through the `tool_name` / `tool_input` path in
`PreToolUse` / `PostToolUse` hooks.

### Interception pattern

1. **`PreToolUse`** (matcher: `null` = all tools): call `harness.resolveCall(kind, name, input)`.
   - **Stub hit:** `permissionDecision: "deny"` (block real execution), stash
     `{ toolUseId, output | error }` in a per-hook `Map`.
   - **Passthrough:** `permissionDecision: "allow"` (real tool runs).
2. **`PostToolUse`:** for allowed calls, `harness.recordCall(kind, name, input, { stubbed: false, output })`
   from `tool_response`.
3. **`PostToolUseFailure`:** for denied stubbed calls, return
   `hookSpecificOutput.updatedToolOutput` with serialized stub output (or error envelope);
   `harness.recordCall(..., { stubbed: true, output | error })`.

### Kind mapping

| `tool_name` prefix / shape | `CallKind` |
|----------------------------|------------|
| `mcp__…` or registered MCP tools | `tool` |
| Skill tool names (caller-provided map) | `skill` |
| Sub-agent delegate tools (caller-provided map) | `subagent` |
| Default | `tool` |

`createClaudeAgentHooks(harness, { skillNames?, subagentNames? })` lets callers tag
non-default kinds without adapter magic.

### API

```ts
import { createClaudeAgentHooks } from "mockist";

const harness = createHarness({ stubs: [...] });
const hooks = createClaudeAgentHooks(harness, {
  skillNames: ["send_email"],
  subagentNames: ["researcher"],
});

// Pass to Claude Agent SDK options:
// { hooks: { ...hooks, /* merge with your own */ } }
```

Returns `{ PreToolUse, PostToolUse, PostToolUseFailure }` hook matcher arrays compatible
with `@anthropic-ai/claude-agent-sdk` `ClaudeAgentOptions.hooks`.

## MCP — `wrapMcpToolHandler` / `wrapMcpHandlers`

MCP servers handle `tools/call` at a single handler boundary.

### `wrapMcpToolHandler(harness, name, handler)`

Wraps one tool handler: `({ arguments: input }) => result` routes through
`harness.dispatch("tool", name, input, () => handler({ arguments: input }))`.

### `wrapMcpHandlers(harness, handlers)`

`Record<string, McpToolHandler>` → wrapped map, same pattern as `wrapVercelTools`.

For **MCP clients** (agent calls a remote server), use `createMcpClientInterceptor(harness)`
returning a `callTool(name, args)` wrapper.

## OpenAI — `wrapOpenAiTools`

OpenAI function tools with a local `execute` or handler map mirror Vercel:

```ts
wrapOpenAiTools(tools, harness) // Record<string, { execute?, ... }>
```

For the Responses / Chat Completions API without `execute`, use
`createOpenAiToolInterceptor(harness)` that wraps a `runTool(name, args)` callback.

## Harness addition — `resolveCall`

`harness.resolveCall(kind, name, input)` runs the resolver chain without recording or
calling the real tool. Returns:

- `{ matched: true, passthrough: true }` — sequence exhausted with passthrough mode
- `{ matched: true, output }` or `{ matched: true, error }` — stub hit
- `{ matched: false }` — no resolver; caller applies `onUnhandled` policy

Adapters use this in PreToolUse; they record via `recordCall` or `dispatch` on passthrough.

## Dogfood gate

Gate passes when:

1. Unit tests cover each adapter's interception shape (stub blocks real handler, passthrough
   records trajectory).
2. At least one adapter test simulates the SDK hook/handler contract without requiring live
   API keys.

## Out of scope

- Auto `kind: "subagent"` inference for Claude (caller provides name sets).
- `harness.fork()` for shared cassette cursors.
- Installing every SDK as a required dependency of `mockist`.

## Testing

| Adapter | Test file |
|---------|-----------|
| Claude hooks | `test/claude-adapter.test.ts` |
| MCP handlers | `test/mcp-adapter.test.ts` |
| OpenAI tools | `test/openai-adapter.test.ts` |
