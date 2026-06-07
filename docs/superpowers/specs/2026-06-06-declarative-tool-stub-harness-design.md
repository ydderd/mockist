# Declarative Tool-Stub Harness — Requirements

**Date:** 2026-06-06
**Status:** Approved requirements.

## Goal

A TypeScript library that stubs the tool calls an agent makes through the Vercel AI SDK. A stubbed call returns a canned value (or throws); any other call runs the real tool. Every call is recorded so tests can assert what the agent did.

## Who it's for

A developer testing a Vercel AI SDK agent who needs two things:

- **Deterministic tool tests** — stub slow/costly/external tools so the suite is fast and repeatable, and assert the outcomes.
- **Trajectory tests** — assert which tools the model called, with what arguments, in what order, and that it handled a tool failure.

Both run the agent with tools stubbed underneath, then assert — one on a tool's outcome, the other on the model's behavior.

## Scope

- Stubs whole tool calls **at the tool boundary**. It does not mock the DB/HTTP *inside* a tool's `execute`.
- The developer **supplies the model** (a real one, or the SDK's `MockLanguageModelV2`). We don't mock the model.
- Stubs are **hand-authored**. Recording real runs to generate stubs is out of scope (see Extension seams).
- **In-process library**: no daemon, no network, no account. Opt-in is two lines.

## Requirements

1. **Wrap** — `wrapVercelTools(tools, harness)` returns a tools object that routes every tool's `execute` through the harness; the developer passes it to `generateText`/`streamText` in place of the original tools.
2. **Match on name + args** — a stub matches when its `name` (and `kind`, default `"tool"`) equal the call, and: its `match` predicate passes if given, else its `args` deep-equal the input if given, else it matches the name alone. First match wins.
3. **Return or pass through** — a match returns the stub's value (a literal, or a function of the input; may be async). No match runs the real `execute`, subject to the unhandled-call policy (req. 8).
4. **Inject failures** — a stub can throw / return an error instead of a value. It is recorded with the error.
5. **Record a trajectory** — every call is recorded in order: `kind`, `name`, `input`, `output` or `error`, whether it was stubbed, a timestamp, and a stable key.
6. **Assert on plain data** — `harness.trajectory` is a typed, read-only array, with helpers (`callsTo(name)`, `calledWith(name, input)`, counts/order). Developers assert with their runner's own `expect`/`assert`. No custom matchers.
7. **Preserve real behavior** — pass-through keeps `execute` semantics (async, the SDK's second `options` argument). A tool with no `execute` passes through unwrapped.
8. **Unhandled-call policy** — `onUnhandled: 'passthrough' (default) | 'warn' | 'error'`. `'error'` throws on any un-stubbed tool call, giving a fully sealed test.
9. **Reset** — `harness.reset()` clears the trajectory between tests.

## Non-functional

- TypeScript, ESM, strict.
- `ai` is a peer dependency of the published package (a dev dependency for our own tests).
- Runner-agnostic; works under vitest / jest / node:test with no runner as a hard dependency.
- Deterministic: no randomness or wall-clock in matching.
- The adapter relies only on the public fact that a Vercel tool is an object with an optional `execute(input, options)` — it does not import the SDK's internal types.

## Familiar vocabulary

The API uses the names developers already know from existing test doubles, so there is little to learn:

| This library | Jest / Sinon | pytest | MSW |
|---|---|---|---|
| stub returns value | `mockResolvedValue` / `stub.returns` | `Mock(return_value=)` | `http.get(url, resolver)` |
| match on name + args | `stub.withArgs(...)` | callable `side_effect` | request matcher |
| pass through on miss | `stub.callThrough()` | call the real fn | `passthrough()` |
| inject failure | `mockRejectedValue` / `stub.throws` | `side_effect=Exc` | error response |
| trajectory | `toHaveBeenCalledWith` | `mock.call_args_list` | `.calls` |
| unhandled-call policy | — | — | `onUnhandledRequest` |

## Architecture

A framework-agnostic core behind a thin Vercel adapter:

- `core/types.ts` — `Call`, `Stub`, `Resolver`, `CallKind`.
- `core/identity.ts` — `identify(kind, name, input) → key`.
- `core/registry.ts` — `defineStubs` + `predicateResolver`.
- `core/recorder.ts` — in-memory trajectory + redaction hook.
- `core/harness.ts` — `createHarness` / `dispatch`: resolver pipeline + unhandled-call policy + recording; exposes `trajectory`, helpers, `reset()`.
- `adapters/vercel.ts` — `wrapVercelTools`.
- `index.ts` — public API.

On each tool call the adapter calls `harness.dispatch(kind, name, input, original)`: walk the resolvers, first hit wins; on no hit, apply the unhandled-call policy (run `original`, warn, or throw); record the call either way.

`CallKind` is `"tool" | "skill" | "subagent"`. Only the tool adapter ships now; the types support the other kinds so future adapters are additive.

## Extension seams (built now, not implemented now)

Four shapes exist so a future record-and-replay capability (capture real calls, generate stubs from them) can be added without a rewrite. None of them add behavior today:

- **Stable call identity** — `identify(kind, name, input)`; stamped on each recorded call now, reusable as a fixture key later.
- **One Call record shape** — used by the recorder now; the same struct for persisted fixtures later.
- **Ordered resolver list** — `resolvers: Resolver[]`; a future fixture-replay resolver inserts before pass-through with no adapter change.
- **Redaction hook** — `redact?: (call) => Call`, no-op by default; required before capturing real (production) calls.

## Acceptance criteria

Driving a real `generateText` loop with `MockLanguageModelV2`:

1. A stubbed tool returns its value to the model; the real `execute` never runs; the trajectory shows it stubbed.
2. An error-injecting stub produces the recorded error and the agent runs its failure path.
3. An un-stubbed tool runs for real; the trajectory shows it not stubbed, with the real output.
4. With `onUnhandled: 'error'`, an un-stubbed call throws instead of running.
5. All of the above are asserted with plain trajectory data — no custom matcher.
6. A tool with no `execute` is returned untouched; pass-through receives the SDK's `options` argument.

## Out of scope (this version)

Recording/replaying real runs; mocking dependencies inside a tool's `execute`; MCP / Anthropic / skill / sub-agent adapters; model mocking; custom test-runner matchers; any hosted / CI-gating / eval-scoring features.

## Backlog

- **Sequential stubs** — `[error, then ok]` so a clean retry-to-success can be tested. (Until then, a stateful result function is the workaround.)
- **Record → generate stubs** — capture real runs and emit hand-editable stubs (what the extension seams enable).
- **Dependency replay inside `execute`** — mock the DB/HTTP a tool performs internally.
- **More adapters** — MCP, Anthropic / Claude Agent SDK (skills and sub-agents flow through its tool-call path), OpenAI.
- **Optional runner-specific matchers** — e.g. `toHaveCalledTool`, once we know which runner users want.
- **Schema-grounded stubs** — validate a stub's output against the tool's JSON Schema, and generate a starter stub from it.

## Not this

- **No daemon / IPC / server.** It breaks the two-line opt-in.
- **No AI-generated, non-deterministic mocks in the runtime.** Determinism is the point. If generation is ever added, it is an authoring aid that emits concrete stubs — never runtime behavior.

## Appendix — illustrative API (the plan pins exact signatures)

```ts
import { generateText } from "ai";
import { createHarness, wrapVercelTools, defineStubs } from "toolest"; // name TBD

const harness = createHarness({
  onUnhandled: "passthrough", // | "warn" | "error"
  stubs: defineStubs([
    { name: "get_weather", args: { city: "Paris" }, result: { tempC: 21 } }, // name + args
    { name: "search", match: (i) => i.q.includes("docs"), result: { hits: [] } }, // predicate
    { name: "flaky", result: () => { throw new Error("upstream 503"); } }, // failure
    { name: "now", result: "2026-06-06T00:00:00Z" }, // name only
  ]),
});

const result = await generateText({
  model, // user-supplied (real or MockLanguageModelV2)
  tools: wrapVercelTools(myTools, harness),
  prompt: "What's the weather in Paris?",
});

expect(harness.callsTo("get_weather")).toHaveLength(1);
expect(harness.trajectory[0]).toMatchObject({ name: "get_weather", stubbed: true });
```
