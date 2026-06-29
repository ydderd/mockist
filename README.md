# mockist

Unit test the tool calls your agent makes: which tool, what args, what order,
what result or error, and whether real code ran.

mockist wraps the **agentic tool/skill boundary**. It does not mock the LLM,
provider SDK, database, HTTP client, queue, or the internals of `execute`. It
only controls and records the boundary where the agent calls your tools.

## At a glance

| | |
|---|---|
| **What it is** | A local test harness for agent **tool-call trajectories** — stubs, cassettes, assertions |
| **What it tests** | Did the agent call the right tool/skill, with the right args, in the right order? |
| **What it does not test** | Code *inside* a tool's `execute` (DB, HTTP, queues) — use `vi.mock`, MSW, testcontainers |
| **Language** | TypeScript on **Node 22+** (Python port is a separate repo; see [backlog](docs/BACKLOG.md)) |
| **Model** | Bring your own scripted/mock model (`MockLanguageModelV3`, etc.) — mockist does not stub the LLM |

**Good fit:** you pass a tools array (or MCP handlers / Claude hooks) to an agent SDK and want fast, deterministic CI tests for tool-use behavior.

**Poor fit:** you need to prove `execute` talks to Postgres correctly, or you use a framework with no hook/wrap point at the tool boundary (see [compatibility](#compatibility) below).

```bash
npm install @ydderd/mockist ai zod
```

## Compatibility

### Supported today

| Library / surface | Adapter | Notes |
|-------------------|---------|-------|
| [Vercel AI SDK](https://sdk.vercel.ai/) (`ai`) | `wrapVercelTools(tools, harness)` | Primary adapter; dogfooded on a real app. Tools **without** `execute` (client-forwarded) pass through untouched. |
| [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) | `createClaudeAgentHooks(harness)` | `PreToolUse` / `PostToolUse` hook interception. Tag skills/sub-agents via `skillNames` / `subagentNames`. |
| MCP **server** handlers | `wrapMcpHandlers(handlers, harness)` | Wrap `tools/call` handlers on your server. |
| MCP **client** calls | `createMcpClientInterceptor(harness)` | Intercept outbound `callTool` from your app. |
| OpenAI-style local tools | `wrapOpenAiTools(tools, harness)` | Tools with a local `execute`; also `createOpenAiToolInterceptor` for manual dispatch. |
| Vitest | `@ydderd/mockist/vitest-matchers` | `toHaveCalledTool`, `toHaveToolTrajectory`, cassette setup via `vitest-setup`. |
| Jest | `@ydderd/mockist/jest-matchers` | Same matchers; setup via `jest-setup`. |

Runnable wiring for each row: [`examples/`](examples/README.md).

### Not supported (use something else)

| You need | Why mockist is not the tool | Use instead |
|----------|----------------------------|-------------|
| Stub HTTP/DB/queue **inside** `execute` | That is implementation unit testing, not the agent boundary | `vi.mock`, nock, MSW, Polly, testcontainers |
| Mock the LLM / model routing | Out of scope — mockist sits below the model, at tool dispatch | SDK mock models (`MockLanguageModelV3`), fixture responses |
| **LangChain**, **LangGraph**, **LlamaIndex**, **CrewAI**, **AutoGen** | No first-party adapter yet | Wrap at your framework's tool `execute` boundary yourself, or open an issue; Python port may add LangChain first |
| **Anthropic Messages API** (raw, no Agent SDK hooks) | No hook surface to intercept | Agent SDK hooks adapter, or wrap your own tool runner |
| **Google Gemini** / Vertex tool calling | No adapter | Wrap local tool handlers if you control dispatch |
| Custom skill systems that **never** hit `execute` or hooks | No intercept point (e.g. hard-coded integration skills) | Refactor to a hookable boundary, or test that layer directly |
| Workflow steps with **no tool boundary** (conditions, transforms, queue workers) | Nothing to wrap | Ordinary unit/integration tests on that code path |
| Python | Separate package (spec only today) | [`docs/superpowers/specs/2026-06-29-python-port-repo-spec.md`](docs/superpowers/specs/2026-06-29-python-port-repo-spec.md) |

If your stack is "tools with `execute` (or MCP/Claude hooks) passed to an agent loop," mockist likely fits. If tool calls never converge on a single dispatch point you can wrap, fix that first or pick a narrower test layer.

## Prompt for your coding agent

Copy the block below into Cursor, Copilot, Claude Code, or similar when adding mockist to an existing repo. Replace the bracketed placeholders.

<details>
<summary>Copy prompt (click to expand)</summary>

```text
Integrate @ydderd/mockist into this repo for agent tool-boundary tests.

Context:
- mockist stubs/replays tool *calls* at the SDK boundary (name, args, order, result/error).
- It does NOT mock the LLM, and does NOT replace vi.mock/MSW for code inside execute().
- Package: npm install @ydderd/mockist (peer: ai ^6, zod ^4 for Vercel AI SDK).
- Docs: README compatibility table + docs/GUIDE.md.

My stack:
- Agent SDK: [Vercel AI SDK | Claude Agent SDK | MCP server | MCP client | OpenAI local tools]
- Test runner: [Vitest | Jest]
- Entry point where tools are assembled: [file path or function name, e.g. createWorkflowTools()]

Tasks:
1. Find where tools/handlers are passed to the agent and wrap with the matching adapter:
   - Vercel: wrapVercelTools(tools, harness)
   - Claude Agent SDK: createClaudeAgentHooks(harness) in SDK options.hooks
   - MCP server: wrapMcpHandlers(handlers, harness)
   - MCP client: createMcpClientInterceptor(harness)
   - OpenAI-style: wrapOpenAiTools(tools, harness)
2. Add a test that uses createHarness({ stubs: [...], onUnhandled: "error" }) and a scripted/mock model (not a live API).
3. Assert harness.trajectory (or vitest/jest matchers: import "@ydderd/mockist/vitest-matchers").
4. Mirror patterns from mockist examples/<sdk>/integration.ts in the mockist repo if helpful.

Do not mock prisma/fetch/queue inside tool execute for trajectory tests — stub at the tool boundary instead.
```

</details>

More prompts (cassette record/replay, multi-agent, schema stubs): [docs/GUIDE.md — Prompts for coding agents](docs/GUIDE.md#prompts-for-coding-agents).

## Why

Agent tests often fail in one of two ways:

- They mock too low, so the test proves your DB/HTTP mocks work but not that the
  agent called the right tool.
- They run live, so failures are slow, expensive, and hard to reproduce.

mockist gives you a middle layer: deterministic tests for the agent's tool-use
behavior.

## The Shape

In your existing test, wrap the tools before passing them to the agent:

```ts
import {
  createHarness,
  expectCalledWith,
  expectNoPassthroughCalls,
  wrapVercelTools,
} from "@ydderd/mockist";

const harness = createHarness({
  onUnhandled: "error",
  stubs: [
    {
      name: "get_weather",
      args: { city: "Paris" },
      result: { city: "Paris", tempC: 21 },
    },
  ],
});

const result = await runAgent({
  prompt: "What's the weather in Paris?",
  tools: wrapVercelTools(myTools, harness),
});

expect(result.text).toContain("21");
expect(expectCalledWith(harness.trajectory, "get_weather", { city: "Paris" }).pass).toBe(true);
expect(expectNoPassthroughCalls(harness.trajectory).pass).toBe(true);
```

`runAgent` is your app's agent entry point. `myTools` are your real SDK tool
definitions. mockist sits between them.

For a runnable Vercel AI SDK test with `MockLanguageModelV3`, see
[`examples/vercel-ai/stub-trajectory.test.ts`](examples/vercel-ai/stub-trajectory.test.ts).

## What You Can Test

| Need | Use |
|------|-----|
| Return canned tool output | `stubs: [{ name, args, result }]` |
| Inject a tool failure | `result: () => { throw new Error("upstream 503"); }` |
| Test retries or polling | `sequence: [{ error }, { result }]` |
| Fail on unexpected tool calls | `onUnhandled: "error"` |
| Assert call order and args | `harness.trajectory` + assertion helpers |
| Freeze one live run | `cassette: "fixtures/flow.json"` + `MOCKIST_RECORD=1` |
| Share default stubs | `defineStubs([...])` and merge arrays, narrowest first |

## Record And Replay

Cassettes are a feature, not the whole product: record a real tool-boundary run
once, then replay the tool results in local/CI tests.

```ts
const harness = createHarness({
  cassette: "fixtures/weather-flow.json",
  onUnhandled: "error",
});
```

```bash
MOCKIST_RECORD=1 vitest weather-flow  # records real tool outputs
vitest weather-flow                   # replays from the cassette
```

The cassette stores tool name, input, output or error, and match rules. It does
not record HTTP/DB calls inside your tool.

## Docs Map

- [Guide](docs/GUIDE.md): compatibility detail, agent prompts, stubs, cassettes, adapters
- [Examples](examples/README.md): runnable copy-paste wiring per SDK
- [Backlog](docs/BACKLOG.md): roadmap, scope decisions, findings
- [Python port spec](docs/superpowers/specs/2026-06-29-python-port-repo-spec.md):
  starting requirements for a separate Python package

## What Not To Use This For

mockist is not a replacement for unit tests of tool internals. If you own the
tool body, test its DB/HTTP/queue behavior with normal tools such as `vi.mock`,
nock/MSW/Polly, or testcontainers.

mockist is also not an eval dashboard. It is a local, in-repo test harness for
tool-call behavior.

## License

[Elastic License 2.0](LICENSE) - source-available, including commercial use, with
the limits described in the license. See [docs/LICENSING.md](docs/LICENSING.md)
for the practical summary.
