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

`"passthrough"` runs the real tool once the sequence is spent — and because the
call *matched* a stub, it defers to that tool even under `onUnhandled: "error"`
(the policy governs *un-stubbed* calls, not deliberate passthrough).

## Record → replay (cassettes)

Capture a real tool-boundary run once, replay it as a hand-editable JSON cassette.

```ts
// record once (either form runs real model + tools):
//   MOCKIST_RECORD=1 vitest weather-flow
//   mockist record -- vitest weather-flow
// replay every run after:
const harness = createHarness({
  cassette: "fixtures/weather-flow.json",
  onUnhandled: "error", // seal: a call the cassette didn't record fails. Omit for passthrough.
});
```

A cassette is an overlay: matched calls are served from the file; unmatched calls follow
`onUnhandled`. In **record** mode (`MOCKIST_RECORD` set), real tools always run —
`onUnhandled: "error"` is ignored so the cassette can capture live responses. Recording
requires the once-registered setup module so cassettes flush without a per-test `save()` —
Vitest: `setupFiles: ["mockist/vitest-setup"]`; Jest:
`setupFilesAfterEnv: ["mockist/jest-setup"]`. Secrets in recorded inputs/outputs are scrubbed
to `[REDACTED:<field>]` (error messages are not redacted), and redacted input fields
auto-wildcard so replay still matches. Per-entry `match: "name"` or
`match: { ignore: ["input.requestId"] }` relax matching for name-only or noisy fields.
Inspect coverage with `harness.cassetteState()` / `expectCassetteFullyUsed(...)`; assert
call order (name/kind only) by feeding `cassetteExpectedCalls(harness)` to
`expectExactTrajectory`.

## Assertions

`harness.trajectory` is a typed, read-only array of every call (`name`, `input`,
`output`/`error`, `stubbed`). Helpers: `harness.callsTo(name)`,
`harness.calledWith(name, input)`. Call `harness.reset()` between tests (clears
trajectory, sequence cursors, and cassette consumption state; the stub list is fixed at
`createHarness` time).

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
> stub coverage). Deliberate sequence passthrough (`onSequenceExhausted: "passthrough"`)
> also records `stubbed: false`, so these helpers will flag it.

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

`createHarness({ resolvers: [...] })` appends custom matchers **after** hand-authored
stubs and (in replay mode) the cassette resolver. They handle calls those layers missed
— they do **not** override an already-matching stub or cassette entry. For defaults +
overrides, merge stub arrays; reserve `resolvers` for dynamic or cross-cutting logic
(e.g. logging).

## Multi-agent workflows (sub-agents & handoffs)

mockist's unit of test is the **tool/skill call boundary**. For workflows with more
than one agent loop, use one of two patterns depending on how much control you have
over tool assembly.

### Pattern A — one shared harness (canonical when you control assembly)

Pass the **same** `Harness` to every `wrapVercelTools` call — parent loop, nested
sub-agent loop, and handoff tool factories. All calls land in one trajectory in
execution order. Works for **nested** sub-agent loops (child runs inside a parent
tool) and **sequential** handoffs when you can thread the harness through.

```ts
const harness = createHarness({
  stubs: mergeStubs(CHILD_STUBS, PARENT_STUBS),
  onUnhandled: "error",
});

const parentTools = wrapVercelTools(createParentTools(), harness);
const childTools = wrapVercelTools(createChildTools(), harness);

// parent loop → handoff / nested child loop → parent resumes
// assert one trajectory:
expect(harness.trajectory.map((c) => c.name)).toEqual([
  "context_recall",
  "delegate_to_researcher",
  "search",
  "summarize",
  "send_reply",
]);
```

Layer child stubs before parent stubs so child-specific overrides win (`mergeStubs`
convention: test → fixture → suite, first match wins).

### Pattern B — merge trajectories (separate loops)

When each loop already has its own harness (library boundaries, separate test
phases, or different `onUnhandled` policies), merge explicitly:

```ts
import {
  createHarness,
  mergeHarnessTrajectories,
  wrapVercelTools,
} from "mockist";

const parentHarness = createHarness({ stubs: PARENT_STUBS });
const childHarness = createHarness({ stubs: CHILD_STUBS });

await runParentLoop(wrapVercelTools(parentTools, parentHarness));
parentHarness.recordCall("subagent", "researcher", { task: "find docs" });
await runChildLoop(wrapVercelTools(childTools, childHarness));

const trajectory = mergeHarnessTrajectories(parentHarness, childHarness);
expect(trajectory.map((c) => c.name)).toEqual([
  "context_recall",
  "researcher", // kind: "subagent" — handoff marker
  "search",
]);
```

`recordCall("subagent", name, input)` marks a handoff boundary without running a
resolver. `mergeHarnessTrajectories` concatenates segments in argument order (not
by timestamp). For a flat array, use `concatTrajectories(seg1, seg2, ...)`.

## Not yet (backlog)

Next up, all at the agentic tool/skill **boundary**: more SDK adapters (Claude Agent SDK /
MCP / OpenAI); schema-grounded stubs; runner integrations (Vitest/Jest matchers wrapping
the assertion helpers above); and a CI GitHub Action. Workflow composition v1 is shipped
(shared harness, `mergeHarnessTrajectories` / `concatTrajectories`, `recordCall` handoff
markers — see [Multi-agent workflows](#multi-agent-workflows-sub-agents--handoffs) above).
Deferred from that work: `harness.fork()` and automatic sub-agent markers via adapters.
Out of scope by design: dependency replay / DB-HTTP stubbing *inside* `execute` (that's
ordinary unit testing — use `vi.mock` / nock / MSW / testcontainers). Source of truth and
ordering: [`docs/BACKLOG.md`](docs/BACKLOG.md).

## License

[Elastic License 2.0](LICENSE) — source-available. You may use, copy, modify, and
redistribute mockist freely, **including inside commercial software**, with three
limits: you may not offer it to third parties as a hosted or managed service, you
may not circumvent license-key functionality, and you may not remove licensing
notices. See [LICENSE](LICENSE) for the full terms.
