# mockist guide

This guide is the reference layer behind the README. It is organized by task so
humans can skim and coding agents can jump to the relevant mechanism.

## Compatibility

The README has the quick matrix; this section is the detail layer.

### Requirements

- **Runtime:** Node.js 22+ (see `package.json` `engines`).
- **Package:** `@ydderd/mockist` on npm (`ai` and `zod` are peer deps when using the Vercel AI SDK adapter).
- **Test surface:** a place you control where tool/skill calls are dispatched — `execute`, MCP `tools/call`, Claude `PreToolUse`, or an equivalent runner you wrap.

### Adapter coverage

| Surface | Entry point | Intercept point | Example |
|---------|-------------|-----------------|---------|
| Vercel AI SDK | `wrapVercelTools` | `tool.execute` | [`examples/vercel-ai/integration.ts`](../examples/vercel-ai/integration.ts) |
| Claude Agent SDK | `createClaudeAgentHooks` | `PreToolUse` deny + `PostToolUseFailure` inject | [`examples/claude-agent-sdk/integration.ts`](../examples/claude-agent-sdk/integration.ts) |
| MCP server | `wrapMcpHandlers` | per-tool handler | [`examples/mcp/integration.ts`](../examples/mcp/integration.ts) |
| MCP client | `createMcpClientInterceptor` | outbound `callTool` | same MCP example |
| OpenAI-style tools | `wrapOpenAiTools` / `createOpenAiToolInterceptor` | local `execute` or manual dispatch | [`examples/openai/integration.ts`](../examples/openai/integration.ts) |

### Edge cases (still supported, with caveats)

- **Vercel tools without `execute`:** returned unchanged; mockist cannot stub client-forwarded tools.
- **Passthrough policy:** `onUnhandled: "passthrough"` runs real `execute` — fine for record mode, risky for sealed unit tests.
- **Multi-agent:** one shared harness (Pattern A) or `mergeHarnessTrajectories` (Pattern B) — see [Multi-Agent Workflows](#multi-agent-workflows).
- **Skills vs tools (Claude):** use `skillNames` / `subagentNames` so trajectory `kind` is accurate.

### Explicitly out of scope

| Category | Examples |
|----------|----------|
| Dependency I/O inside `execute` | Prisma, `fetch`, BullMQ, Gmail SDK |
| LLM / provider mocking | Live APIs, routing, token streams |
| Frameworks without an adapter | LangChain, LangGraph, LlamaIndex, CrewAI, AutoGen, raw Gemini SDK |
| Non-tool workflow code | Engine steps that never expose a tool boundary |
| Hosted eval / trace products | LangSmith, Braintrust, etc. — different job |

For frameworks without an adapter, you can still use mockist if you can wrap the
same `name + input → output` dispatch yourself (`harness.dispatch` or
`createOpenAiToolInterceptor`-style wrapper).

## Prompts for coding agents

Copy one of these into your coding agent when wiring mockist. Adjust paths and SDK
names to match the repo.

### Greenfield trajectory test (any supported SDK)

```text
Add a mockist tool-boundary test to this repo.

Install: npm install -D @ydderd/mockist @ydderd/mockist/vitest-matchers (if Vitest).

Rules:
- Test agent tool trajectory only (name, args, order, stubbed results/errors).
- onUnhandled: "error" so unexpected tool calls fail the test.
- Use a mock/scripted model — no live LLM API keys in CI.
- Do not vi.mock dependencies inside tool execute for these tests.

Steps:
1. Locate tool assembly (function that returns tools/handlers).
2. Wrap with the adapter from the README compatibility table.
3. createHarness({ stubs: [...] }) with stubs for every tool the scripted model will call.
4. Run the agent entry point in a test.
5. Assert harness.trajectory or use expect(harness).toHaveCalledTool(...).

Reference implementation in the mockist repo: examples/<sdk>/integration.ts
```

### Vercel AI SDK

```text
Add mockist to our Vercel AI SDK agent tests.

Wrap: wrapVercelTools(myTools, harness) before passing tools to generateText/streamText.
Harness: createHarness({ stubs, onUnhandled: "error" }).
Model: MockLanguageModelV3 or existing test model — not a live provider.
Assert: expectCalledWith(harness.trajectory, ...) or import "@ydderd/mockist/vitest-matchers".

Find: imports from "ai", tool({ execute }), and where tools enter generateText/streamText.
Example: mockist/examples/vercel-ai/stub-trajectory.test.ts
```

### Claude Agent SDK

```text
Add mockist to Claude Agent SDK tests via hooks.

const hooks = createClaudeAgentHooks(harness, { skillNames: [...], subagentNames: [...] });
Merge hooks into ClaudeAgentOptions.hooks (PreToolUse, PostToolUse, PostToolUseFailure).
Stub hits deny real execution and inject output through PostToolUseFailure.

If we cannot run the real SDK in CI, simulate hook shapes like examples/shared/claude-hook-sim.ts.
Example: mockist/examples/claude-agent-sdk/hooks-stub.test.ts
```

### MCP

```text
Add mockist to MCP tests.

Server: wrapMcpHandlers({ toolName: handler, ... }, harness) before registering handlers.
Client: const callTool = createMcpClientInterceptor(harness)(realCallTool).

Assert both sides share one harness.trajectory when testing an app that calls its own server.
Example: mockist/examples/mcp/server-and-client.test.ts
```

### Cassette record → replay

```text
Add a mockist cassette test.

Harness: createHarness({ cassette: "fixtures/<name>.json", onUnhandled: "error" }).
Vitest setup: test.setupFiles includes "@ydderd/mockist/vitest-setup".

Record once locally: MOCKIST_RECORD=1 vitest <test-file>
Commit the JSON cassette; CI replays without live tool backends.

After replay, assert expectCassetteFullyUsed(harness.cassetteState()) and trajectory match.
Guide section: Record And Replay Cassettes in docs/GUIDE.md
```

### Multi-agent workflow

```text
Add a whole-workflow mockist test spanning multiple agent loops.

Prefer Pattern A: one createHarness, mergeStubs per agent, wrapVercelTools(..., sameHarness) everywhere.
For separate loops: mergeHarnessTrajectories(parent, child) and recordCall("subagent", name, input) at handoffs.

onUnhandled: "error" on the shared harness.
Guide section: Multi-Agent Workflows in docs/GUIDE.md
```

## Mental Model

mockist has three moving parts:

1. `createHarness(...)` creates a boundary harness.
2. An adapter wraps your SDK's tool surface and routes calls through the harness.
3. Assertions read `harness.trajectory`.

```ts
const harness = createHarness({
  stubs: [{ name: "search", result: { hits: [] } }],
  onUnhandled: "error",
});

const tools = wrapVercelTools(myTools, harness);
await runAgent({ tools });

expect(harness.trajectory.map((c) => c.name)).toEqual(["search"]);
```

The unit under test is the agent's tool-use behavior. mockist does not inspect or
mock the implementation inside a tool's `execute`.

## Stubs

A stub matches on `kind` (default `"tool"`), `name`, and optionally `args` or a
predicate.

```ts
const harness = createHarness({
  stubs: [
    { name: "get_weather", args: { city: "Paris" }, result: { tempC: 21 } },
    { name: "search", match: (i) => i.q.includes("docs"), result: { hits: [] } },
    { name: "now", result: "2026-06-29T00:00:00Z" },
  ],
});
```

Matching rules:

- `match` predicate wins when present.
- Else `args` deep-equals the call input when present.
- Else the stub matches by name only.
- First match wins.

`onUnhandled` controls misses:

| Policy | Behavior |
|--------|----------|
| `"passthrough"` | run the real tool |
| `"warn"` | warn, then run the real tool |
| `"error"` | fail before the real tool runs |

Use `onUnhandled: "error"` for sealed unit tests.

## Error Injection

Throw from a stub to test the agent's failure path without forcing a real
dependency to fail.

```ts
const harness = createHarness({
  stubs: [{
    name: "get_weather",
    result: () => { throw new Error("upstream 503"); },
  }],
});
```

The thrown error is recorded on the trajectory.

## Sequential Stubs

Use `sequence` when the same call should behave differently over time: retries,
polling, pagination, or failure-then-success flows.

```ts
const harness = createHarness({
  stubs: [{
    name: "search",
    args: { q: "billing" },
    sequence: [
      { error: new Error("timeout") },
      { result: { hits: ["doc-1"] } },
    ],
    onSequenceExhausted: "error",
  }],
});
```

Exhaustion modes:

| Mode | Behavior |
|------|----------|
| `"error"` | default; fail when the sequence runs dry |
| `"repeat-last"` | keep serving the final step |
| `"passthrough"` | run the real tool after the sequence is spent |

Inspect sequence coverage:

```ts
const state = harness.sequenceState();
```

## Assertions

`harness.trajectory` is a read-only array of every call:

```ts
{
  kind: "tool",
  name: "get_weather",
  input: { city: "Paris" },
  output: { tempC: 21 },
  stubbed: true,
  ts: 1780000000000,
  key: "..."
}
```

The runner-agnostic helpers return `{ pass, message() }`.

```ts
import {
  expectCalledTool,
  expectCalledWith,
  expectExactTrajectory,
  expectNoPassthroughCalls,
  expectSubsequence,
} from "@ydderd/mockist";

const result = expectSubsequence(harness.trajectory, [
  { name: "get_weather", input: { city: "Paris" }, stubbed: true },
  { name: "send_reply" },
]);

expect(result.pass, result.message()).toBe(true);
```

Common helpers:

| Helper | Use |
|--------|-----|
| `expectExactTrajectory` | full trajectory in exact order |
| `expectSubsequence` | ordered calls with gaps allowed |
| `expectCalledTool` | at least one call to a tool |
| `expectCalledWith` | deep-subset input match |
| `expectNoUnhandledCalls` | no passthrough calls |
| `expectNoPassthroughCalls` | same guarantee, phrased by real-code leakage |
| `expectNoExhaustedSequences` | every sequence had enough steps |

Vitest and Jest matchers are available:

```ts
import "@ydderd/mockist/vitest-matchers";

expect(harness).toHaveCalledTool("get_weather");
expect(harness).toHaveToolTrajectory([{ name: "a" }, { name: "b" }]);
```

## Record And Replay Cassettes

Cassettes record real tool-boundary calls once and replay them later.

```ts
const harness = createHarness({
  cassette: "fixtures/weather-flow.json",
  onUnhandled: "error",
});
```

Record:

```bash
MOCKIST_RECORD=1 vitest weather-flow
```

Replay:

```bash
vitest weather-flow
```

In record mode, real tools run and the cassette is overwritten. In replay mode,
matching calls are served from the cassette. With `onUnhandled: "error"`, a call
the cassette did not record fails fast.

A cassette is ordered JSON:

```json
{
  "mockist_format_version": 1,
  "recordedAt": "2026-06-29T18:04:00Z",
  "redactions": [],
  "calls": [
    {
      "name": "get_weather",
      "input": { "city": "Paris" },
      "output": { "city": "Paris", "tempC": 21 }
    }
  ]
}
```

Replay is consume-once. mockist scans for the first unconsumed entry with the
same `kind`/`name` and matching input, then returns `output` or throws `error`.

Recording setup:

```ts
// vitest.config.ts
export default {
  test: {
    setupFiles: ["@ydderd/mockist/vitest-setup"],
  },
};
```

```js
// jest config
export default {
  setupFilesAfterEnv: ["@ydderd/mockist/jest-setup"],
};
```

Secret-bearing fields are redacted to `[REDACTED:<field>]`. Redacted input paths
act as wildcards during replay. Error messages are not redacted.

Relax noisy matching fields:

```json
{
  "name": "search",
  "input": { "q": "billing", "requestId": "abc" },
  "output": { "hits": [] },
  "match": { "ignore": ["input.requestId"] }
}
```

Assert cassette coverage:

```ts
import {
  cassetteExpectedCalls,
  expectCassetteFullyUsed,
  expectExactTrajectory,
} from "@ydderd/mockist";

expect(expectExactTrajectory(harness.trajectory, cassetteExpectedCalls(harness)).pass).toBe(true);
expect(expectCassetteFullyUsed(harness.cassetteState()).pass).toBe(true);
```

## Layered Stub Registries

Use plain arrays for suite defaults and per-test overrides. Put narrower stubs
first.

```ts
import { createHarness, defineStubs } from "@ydderd/mockist";

export const SUITE_STUBS = defineStubs([
  { name: "web_search", match: () => true, result: [] },
  { name: "read_ontology", result: { content: "Default ICP." } },
]);

export function mergeStubs(...layers: ReturnType<typeof defineStubs>[]) {
  return layers.flat();
}

const harness = createHarness({
  onUnhandled: "error",
  stubs: mergeStubs(
    defineStubs([{ name: "web_search", args: { q: "Acme" }, result: ["hit"] }]),
    SUITE_STUBS,
  ),
});
```

`reset()` clears trajectory and consumption state. It does not change registered
stubs. Create a new harness for tests that need different stubs.

## Multi-Agent Workflows

When you control tool assembly, share one harness across loops:

```ts
const harness = createHarness({
  stubs: mergeStubs(CHILD_STUBS, PARENT_STUBS),
  onUnhandled: "error",
});

const parentTools = wrapVercelTools(createParentTools(), harness);
const childTools = wrapVercelTools(createChildTools(), harness);
```

All calls land in one trajectory.

When loops already have separate harnesses, merge explicitly:

```ts
import { mergeHarnessTrajectories } from "@ydderd/mockist";

parentHarness.recordCall("subagent", "researcher", { task: "find docs" });

const trajectory = mergeHarnessTrajectories(parentHarness, childHarness);
```

`recordCall("subagent", name, input)` marks a handoff boundary without running a
resolver.

## SDK Adapters

```ts
import {
  createClaudeAgentHooks,
  createMcpClientInterceptor,
  wrapMcpHandlers,
  wrapOpenAiTools,
  wrapVercelTools,
} from "@ydderd/mockist";
```

| SDK | Pattern |
|-----|---------|
| Vercel AI SDK | `wrapVercelTools(tools, harness)` |
| Claude Agent SDK | pass `createClaudeAgentHooks(harness)` into SDK options |
| MCP server | `wrapMcpHandlers(handlers, harness)` |
| MCP client | `createMcpClientInterceptor(harness)` |
| OpenAI-style local tools | `wrapOpenAiTools(tools, harness)` |

Runnable examples:

- [Vercel AI SDK](../examples/vercel-ai/integration.ts)
- [Claude Agent SDK](../examples/claude-agent-sdk/integration.ts)
- [MCP](../examples/mcp/integration.ts)
- [OpenAI](../examples/openai/integration.ts)

## Schema-Grounded Stubs

Generate placeholder stubs and validate stubs or trajectory outputs against a
JSON Schema subset.

```ts
import {
  stubsFromSchemas,
  validateStubsAgainstSchemas,
  validateTrajectoryOutputs,
} from "@ydderd/mockist";

const stubs = stubsFromSchemas(toolDefs);
validateStubsAgainstSchemas(stubs, toolDefs);
validateTrajectoryOutputs(harness.trajectory, toolDefs);
```

## API Map For Agents

Core:

- `createHarness(options)`
- `defineStubs(stubs)`
- `wrapVercelTools(tools, harness)`
- `harness.trajectory`
- `harness.callsTo(name)`
- `harness.calledWith(name, input)`
- `harness.reset()`
- `harness.sequenceState()`
- `harness.cassetteState()`
- `harness.recordCall(kind, name, input, opts?)`

Assertions:

- `expectExactTrajectory`
- `expectSubsequence`
- `expectCalledTool`
- `expectCalledWith`
- `expectNoUnhandledCalls`
- `expectNoPassthroughCalls`
- `expectNoExhaustedSequences`
- `expectCassetteFullyUsed`
- `cassetteExpectedCalls`

Composition and adapters:

- `concatTrajectories`
- `mergeHarnessTrajectories`
- `createClaudeAgentHooks`
- `wrapMcpToolHandler`
- `wrapMcpHandlers`
- `createMcpClientInterceptor`
- `wrapOpenAiTools`
- `createOpenAiToolInterceptor`
