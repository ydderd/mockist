# Claude Agent SDK example

Claude does **not** expose a `wrapTools()` helper. Instead, every tool invocation
fires SDK hooks. mockist registers three:

| Hook | mockist behavior |
|------|------------------|
| `PreToolUse` | `resolveCall()` — deny if stubbed, allow if passthrough |
| `PostToolUse` | record real `tool_response` on passthrough |
| `PostToolUseFailure` | inject `updatedToolOutput` for denied stubbed calls |

## Hook input shape (what mockist receives)

```ts
// PreToolUse
{
  hook_event_name: "PreToolUse",
  tool_name: "Read",              // also used for skills + sub-agents
  tool_input: { file_path: "..." },
  tool_use_id: "toolu_01ABC...",  // correlates Pre ↔ Post
}

// PostToolUse (passthrough only)
{
  hook_event_name: "PostToolUse",
  tool_name: "Read",
  tool_input: { ... },
  tool_response: { content: "..." },  // what the real tool returned
  tool_use_id: "toolu_01ABC...",
}

// PostToolUseFailure (stubbed deny path)
{
  hook_event_name: "PostToolUseFailure",
  tool_name: "Read",
  tool_input: { ... },
  tool_use_id: "toolu_01ABC...",
  error_message: "denied by mockist stub",
}
```

## Files

| File | Purpose |
|------|---------|
| [`integration.ts`](./integration.ts) | Harness, hooks, `mergeClaudeHooks`, `claudeAgentOptionsWithMockist` |
| [`hooks-stub.test.ts`](./hooks-stub.test.ts) | Simulates hook contract without API key |
| [`../shared/claude-hook-sim.ts`](../shared/claude-hook-sim.ts) | `simulateClaudeToolCall()` for tests |

## Run

```bash
npx vitest run examples/claude-agent-sdk
```
