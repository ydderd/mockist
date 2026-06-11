# mockist

Stub the tool calls your agent makes through the Vercel AI SDK. A stubbed call
returns a canned value (or throws); any other call runs the real tool. Every call
is recorded so you can assert what the agent did.

**Suite defaults + per-test overrides:** merge stub arrays (test first, suite
last) — see [Layered stub registries](#layered-stub-registries).

## Quick start

```ts
import { generateText } from "ai";
import { createHarness, defineStubs, wrapVercelTools } from "mockist";

const harness = createHarness({
  onUnhandled: "passthrough", // | "warn" | "error" (fail on any un-stubbed call)
  stubs: [
    { name: "get_weather", args: { city: "Paris" }, result: { tempC: 21 } }, // name + args
    { name: "search", match: (i) => i.q.includes("docs"), result: { hits: [] } }, // predicate
    { name: "flaky", result: () => { throw new Error("upstream 503"); } }, // failure
    { name: "now", result: "2026-06-07T00:00:00Z" }, // name only
    {
      name: "retryable",
      sequence: [{ error: new Error("timeout") }, { result: { ok: true } }],
    }, // ordered calls
  ],
});

const result = await generateText({
  model, // you supply this — a real model or the SDK's MockLanguageModelV3
  tools: wrapVercelTools(myTools, harness),
  prompt: "What's the weather in Paris?",
});

expect(harness.callsTo("get_weather")).toHaveLength(1);
expect(harness.trajectory[0]).toMatchObject({ name: "get_weather", stubbed: true });
```

## Matching

A stub matches when its `kind` (default `"tool"`) and `name` match the call, and:
its `match` predicate passes (if given), else its `args` deep-equal the input (if
given), else it matches the name regardless of input. **First match wins** — stub
order in the array is the override priority. No match runs the real `execute`
(pass-through), unless `onUnhandled: "error"`.

## Sequential stubs

Use `sequence` when the same call should behave differently over time: retries,
pagination, polling, or failure-then-success flows. Each matching call consumes
one step. A step can return a `result` or throw an `error`.

```ts
const harness = createHarness({
  stubs: [{
    name: "search",
    args: { q: "billing" },
    sequence: [
      { error: new Error("timeout") },
      { result: { hits: ["doc-1"] } },
    ],
    onSequenceExhausted: "error", // default | "repeat-last" | "passthrough"
  }],
});
```

## Assertions

`harness.trajectory` is a typed, read-only array of every call (`name`, `input`,
`output`/`error`, `stubbed`). Helpers: `harness.callsTo(name)`,
`harness.calledWith(name, input)`. Call `harness.reset()` between tests (clears
trajectory and sequence cursors; the stub list is fixed at `createHarness` time).

### Trajectory assertion helpers

For readable expectations with diffable failure output, mockist ships a small,
**runner-agnostic** assertion layer over the trajectory. Each helper is a pure
function that returns `{ pass, message() }` — it never throws and never imports a
test framework, so it works under any runner (Vitest/Jest matchers will wrap it
later). `message()` renders an expected-vs-actual diff showing each call's `name`,
`input`, `output`/`error`, and `stubbed` status.

```ts
import {
  expectExactTrajectory,    // full trajectory, in order (same length, every position matches)
  expectSubsequence,        // expected calls appear in order; gaps allowed
  expectCalledTool,         // at least one call to a tool name
  expectCalledWith,         // a call to a tool whose input is a deep-superset of a partial
  expectNoUnhandledCalls,   // nothing hit the onUnhandled policy (everything was stubbed)
  expectNoPassthroughCalls, // nothing ran the real tool (same guarantee, "stubbed" framing)
  expectNoExhaustedSequences,
} from "mockist";

const { pass, message } = expectSubsequence(harness.trajectory, [
  { name: "get_weather", input: { city: "Paris" }, stubbed: true },
  { name: "search" }, // name-only; output/error/stubbed optional
]);
if (!pass) throw new Error(message()); // or: expect(pass, message()).toBe(true)
```

Each expected call spec needs only `name`; provide `input`/`output`/`error`/
`stubbed`/`kind` to tighten the match. In `expectExactTrajectory` and
`expectSubsequence`, every *specified* field must deep-equal the recorded call.
`expectCalledWith` matches on a **deep-subset** of the input (extra fields ignored).

> `expectNoUnhandledCalls` and `expectNoPassthroughCalls` check the same bit
> (`stubbed === false`) — two framings of the same guarantee. Use whichever reads
> better for your `onUnhandled` mode (catch leaks to real tools, or assert full
> stub coverage).

### Sequence exhaustion

`harness.sequenceState()` returns the consumption state of every `sequence` stub —
`{ name, kind, length, consumed, exhausted }`. A sequence is `exhausted` once a
matching call arrives after all its steps were consumed (it ran dry). Assert that
no sequence was under-provisioned:

```ts
const { pass, message } = expectNoExhaustedSequences(harness.sequenceState());
```

## Layered stub registries

You often want **suite-wide defaults** (stub slow or external tools everywhere)
and **per-test overrides** (one scenario needs a specific response). mockist
supports this today — no extra API — by **merging stub arrays** so narrower
stubs are listed **before** broader catch-alls.

Use `defineStubs` to name and export reusable lists (typed identity helper):

```ts
import { createHarness, defineStubs, wrapVercelTools } from "mockist";

// tests/helpers/tool-stubs.ts — shared across the suite
export const SUITE_STUBS = defineStubs([
  {
    name: "web_search",
    match: () => true,
    result: (input: { query: string }) => [
      { title: `Stub: ${input.query}`, url: "https://example.test", snippet: "…" },
    ],
  },
  {
    name: "read_ontology",
    match: () => true,
    result: { success: true, content: "Default ICP and positioning." },
  },
]);

export function mergeStubs(...layers: ReturnType<typeof defineStubs>[]) {
  return layers.flat();
}

export function createTestHarness(testStubs = defineStubs([]), onUnhandled = "error" as const) {
  return createHarness({
    onUnhandled,
    stubs: mergeStubs(testStubs, SUITE_STUBS),
  });
}
```

**Priority:** stubs from earlier layers win. Typical merge order:

```
test overrides  →  describe / fixture stubs  →  SUITE_STUBS (catch-alls last)
```

### Per-test override

```ts
import { createTestHarness, defineStubs } from "./helpers/tool-stubs";

it("uses a specific web_search hit for this prospect", async () => {
  const harness = createTestHarness(
    defineStubs([
      {
        name: "web_search",
        args: { query: "Acme Corp funding" },
        result: [{ title: "Acme raises Series B", url: "https://example.test/acme", snippet: "…" }],
      },
      // read_ontology still comes from SUITE_STUBS — no need to repeat it
    ]),
  );

  const tools = wrapVercelTools(myTools, harness);
  // ...
});
```

### How overrides interact

| Test stub | Suite stub | Incoming call | Winner |
|-----------|------------|---------------|--------|
| `args: { query: "x" }` | `match: () => true` | `{ query: "x" }` | Test (listed first, args match) |
| same | same | `{ query: "y" }` | Suite (test args don't match; suite catch-all does) |
| `match: () => true, result: A` | `match: () => true, result: B` | any | Test (listed first) |

To replace a tool entirely for one test, put a catch-all for that `name` in the
test layer — it sits before the suite entry and always matches first.

### Describe- or fixture-level stubs

Same pattern: export `defineStubs([...])` for a workflow template, agent, or
feature area and pass it as the first layer:

```ts
const PROSPECT_RESEARCH_STUBS = defineStubs([
  { name: "web_search", args: { query: "…" }, result: [/* … */] },
  { name: "read_ontology", args: { topics: "company,icp" }, result: { success: true, content: "…" } },
]);

const harness = createHarness({
  stubs: mergeStubs(PROSPECT_RESEARCH_STUBS, SUITE_STUBS),
  onUnhandled: "error",
});
```

### Test runner lifecycle (Vitest / Jest)

- **Same stubs every test:** one `createTestHarness()` in `beforeEach`, call
  `harness.reset()` in `afterEach`.
- **Different stubs per test:** create a **new harness** in that test (or in
  `beforeEach` with test-specific config). `reset()` does not change which stubs
  are registered.

`onUnhandled: "error"` pairs well with a suite registry: any tool the agent
calls that you forgot to stub fails fast instead of hitting real `execute`.

### What `resolvers` are for

`createHarness({ resolvers: [...] })` appends custom matchers **after** the stub
list. They handle calls the stub list missed — they do **not** override an
already-matching suite stub. For defaults + overrides, merge stub arrays; reserve
`resolvers` for dynamic or cross-cutting logic (e.g. redaction, logging).

## Not yet (backlog)

Next up: **record → replay fixtures**; dependency replay inside `execute` (fetch
first, then Prisma/DB/queue — the moat); sub-agent / whole-workflow trajectory
composition; schema-grounded stubs; runner integrations (Vitest/Jest matchers wrapping
the assertion helpers above); and MCP / Anthropic / OpenAI adapters. Source of truth
and ordering:
[`docs/BACKLOG.md`](docs/BACKLOG.md) (design spec:
`docs/superpowers/specs/2026-06-06-declarative-tool-stub-harness-design.md`).
