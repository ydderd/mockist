# Declarative Tool-Stub Harness — Design / Requirements Spec

**Date:** 2026-06-06
**Status:** Approved (requirements). Implementation plan to follow.
**Companion docs:** [PRIMER.md](../../../PRIMER.md), [OUTLINE.md](../../../OUTLINE.md)

---

## 1. Context & problem

When you build an agent, you hand an SDK a tools array and let a model call those tools. Testing that layer today means hand-mocking each tool's behavior — brittle, drifts from reality, and the unit-of-work the model actually drives (the tool call) is the least-tested part of the stack.

This MVP delivers the smallest useful thing: **let a developer declaratively stub the tool calls an agent makes through the Vercel AI SDK, so tests are deterministic; everything not stubbed passes through to the real tool; and every call is recorded so you can assert on what the agent did.**

This is not a novel category — it is **test-doubles (stubs + spies) applied to agent tool calls**. The design deliberately mirrors settled patterns (`jest.fn()`, Sinon stubs, MSW handlers, pytest `Mock`, Elixir `Mox`) so the learning curve is near zero and we inherit proven ergonomics instead of inventing them.

## 2. Users & primary jobs

A developer (solo or team) building an agent on the **Vercel AI SDK** who wants tests that don't hit real tools. Two jobs, served by one harness:

- **J1 — Deterministic tool-code tests.** Stub the tools you don't want to really run (slow/costly/external); let the tool-under-test pass through; assert its recorded output/outcome. Run fast and deterministically in CI.
- **J2 — Agent trajectory tests.** Assert the *model's* behavior: which tools it called, with what args, in what order, and that it handled an injected tool failure.

Both jobs run the agent with tools stubbed underneath, then assert — J1 on the tool's execution/outcome, J2 on the model's behavior. Same harness, two assertion targets.

## 3. Philosophy & prior-art mapping

The API should read like the tools developers already know. Mapping of our concepts to established patterns:

| Our concept | Jest / Sinon | pytest | Elixir / Mox | MSW / nock |
|---|---|---|---|---|
| Stub returns value | `mockResolvedValue` / `stub.returns` | `Mock(return_value=)` | `Mox.stub/3` | `http.get(url, resolver)` |
| Match on name + args | `stub.withArgs(...)` | callable `side_effect` | `expect` w/ pattern | request matcher |
| Pass-through on miss | `stub.callThrough()` | call the real fn | — | `passthrough()` |
| Error injection | `mockRejectedValue` / `stub.throws` | `side_effect=Exc` | raise in fn | error response |
| Trajectory (spy log) | `toHaveBeenCalledWith` | `mock.call_args_list` | `verify!` | `.calls` |
| Reset between tests | `clearMocks` / `afterEach` | fixture teardown | per-test | `resetHandlers()` |
| Unhandled-call policy | — | — | strict by default | `onUnhandledRequest` |
| Record → replay (deferred) | — | **vcrpy** | — | **nock.back / Polly** |

## 4. Scope boundary

- **Tool-only.** We wrap tools and record the trajectory. We do not touch the model.
- **Tool-boundary stubbing.** We replace whole tool calls. We do **not** reach inside a tool's `execute` to mock its internal DB/HTTP dependencies (that is the deferred "dependency replay" layer).
- **User brings the model.** The developer passes whatever model they want — a real one, or the AI SDK's built-in `MockLanguageModelV2` to script tool-call decisions. We do not provide model mocking.
- **Mode 1 only.** Stubs are hand-authored. Recording real runs to generate stubs (Mode 2) is deferred, but its seams are built now (§7).
- **In-process library.** No daemon, no IPC, no network, no account. Opt-in is ~2 lines.

## 5. Functional requirements

- **FR1 — Wrap.** `wrapVercelTools(tools, harness)` returns a tools object whose every tool routes its `execute` through the harness. Drop-in: the result is passed to `generateText`/`streamText` in place of the original tools.
- **FR2 — Match (name + args).** A stub matches when its `kind` (default `"tool"`) and `name` equal the call and:
  - a `match` predicate is satisfied (takes precedence), else
  - `args` deep-equals the call input, else
  - neither is given (matches the name regardless of input).
  First matching stub wins.
- **FR3 — Stub result / pass-through.** A hit returns a canned value (a literal, or a function of the input; may be async). A miss runs the real `execute` (**pass-through**), unless overridden by the unhandled-call policy (FR9).
- **FR4 — Error injection.** A stub can make the tool **fail** (throw / surface an error) instead of returning a value, recorded as `stubbed: true` with the `error`. (Note: first-class "fail first, then succeed" sequencing is backlogged — see §9. A stateful result function is the escape hatch in the meantime.)
- **FR5 — Trajectory (spy).** Every tool call is recorded in invocation order with: `kind`, `name`, `input`, `output` or `error`, `stubbed` flag, `ts`, and a stable `key`.
- **FR6 — Assertion surface (plain data).** Expose `harness.trajectory` as a typed, read-only array, plus a small set of query helpers (e.g. `callsTo(name)`, `calledWith(name, input)`, counts/order). Developers assert with their own runner's `expect`/`assert`. **No framework-specific matchers** in MVP.
- **FR7 — Fidelity.** Pass-through preserves the real `execute` semantics (async, the SDK's second `options` argument). Tools without an `execute` (client-side / forwarded tools) pass through untouched and unwrapped.
- **FR8 — Reset.** `harness.reset()` clears the trajectory between tests.
- **FR9 — Unhandled-call policy.** A harness option `onUnhandled: 'passthrough' | 'warn' | 'error'` (default `'passthrough'`). `'error'` throws on any un-stubbed tool call — a fully sealed deterministic test (serves J1). `'warn'` logs and passes through.

## 6. Non-functional requirements

- **NFR1 — Friction is binary.** Adoption must be ~2 lines (`createHarness(...)` + `wrapVercelTools(...)`). No account, no config files, no network.
- **NFR2 — TS-first, ESM.** Strict TypeScript; ships as an npm package.
- **NFR3 — Runner-agnostic.** Works under any test runner (vitest, jest, node:test); no runner is a hard dependency. (`ai` is a peer dependency in the product; a dev dependency for our own tests.)
- **NFR4 — Determinism.** Given the same stubs and the same model behavior, results are identical. No randomness or wall-clock in matching.
- **NFR5 — Version tolerance.** The adapter relies only on the public contract that a Vercel tool is an object with an optional `execute(input, options)` (because `tool()` is an identity function in the SDK). It does not import the SDK's internal types.

## 7. Architecture (ratifies the prior design)

A framework-agnostic core behind a thin Vercel adapter.

```
wrapVercelTools(tools, harness)            ← ~2-line opt-in
        │  per execute() call
        ▼
   Vercel adapter ──► harness.dispatch(kind, name, input, original)
                              │
                              ├─ walk resolvers (ordered): first hit → stub value/error
                              ├─ no hit → onUnhandled policy: passthrough(run original) | warn | error
                              └─ record Call (stubbed flag, output/error) → Recorder (in-memory)
```

**Units (one responsibility each):**
- `core/types.ts` — `Call`, `Stub`, `Resolver`, `CallKind`, `Resolution` (shared shapes).
- `core/identity.ts` — `identify(kind, name, input) → key` + stable stringify.
- `core/registry.ts` — `defineStubs` + `predicateResolver` (name / name+args / predicate).
- `core/recorder.ts` — in-memory trajectory + redaction hook.
- `core/harness.ts` — `createHarness` / `dispatch`: resolver pipeline + unhandled-call policy + recording. Exposes `trajectory`, query helpers, `reset()`.
- `adapters/vercel.ts` — `wrapVercelTools` (the execution seam).
- `index.ts` — public API.

**`CallKind` is `"tool" | "skill" | "subagent"`.** Only the **tool** adapter ships in the MVP, but the core types and matching already support the other kinds so future adapters are additive.

**The four Mode-2 seams (present but inert in the MVP)** — built now so record→replay is additive:
1. **Call-identity** — `identify(kind, name, input)`; stamped on each `Call` now, reused as a fixture key later.
2. **Normalized `Call` record** — one struct used by the recorder now and by Mode-2 persistence later.
3. **Ordered resolver pipeline** — `resolvers: Resolver[]`; Mode 2 inserts a `fixtureResolver` before pass-through with zero adapter changes.
4. **Redaction hook** — `redact?: (call) => Call` on the recorder, no-op by default; required before any production capture.

## 8. Acceptance criteria (definition of done)

Driving a real `generateText` loop with `MockLanguageModelV2`:

1. **Stub hit:** a stubbed tool returns its canned value to the model; the real `execute` never runs; the trajectory records `stubbed: true` with that output.
2. **Error path:** an error-injecting stub causes the recorded `error` (`stubbed: true`), and the agent handles it (surfaces it / responds), demonstrating the J2 error path. (Clean retry-to-success is out of scope — needs the backlogged sequential stubs.)
3. **Pass-through:** an un-stubbed tool runs the real `execute`; the trajectory records `stubbed: false` and the real output.
4. **Sealed test:** with `onUnhandled: 'error'`, an un-stubbed tool call throws instead of running.
5. **Assertions:** all of the above are asserted using plain trajectory data + query helpers — no custom matcher required.
6. **Fidelity:** a tool without an `execute` is returned untouched; pass-through receives the SDK's `options` argument.

## 9. Non-goals (MVP) and backlog

**Explicit non-goals for the MVP:**
- Mode 2 record → replay (the VCR/cassette pattern).
- Dependency-mocking *inside* a tool's `execute` (DB/HTTP).
- MCP, Anthropic, skill, or sub-agent adapters.
- Model mocking (the user brings the model).
- Custom test-runner matchers.
- Any hosted / CI-gating / eval-scoring features.

**Backlog (recorded now, post-MVP):**
- **Sequential / once stubs** — `side_effect=[err, ok]` / `mockReturnValueOnce`; first-class "fail then succeed" for J2 recovery.
- **Record → replay (VCR/cassette)** — capture real runs and codegen Mode-1 stubs (vcrpy / Polly / nock.back lineage). Additive via the §7 seams.
- **Dependency replay inside `execute`** — the original PRIMER moat.
- **Additional adapters** — MCP, Anthropic / Claude Agent SDK (skills and sub-agents flow through its one tool-call/hook path), OpenAI.
- **Custom matchers** — optional `toHaveCalledTool` / `toMatchTrajectory` packages once we know which runner users want.
- **Schema-grounded stub generation/validation** — use the tool's JSON Schema (which we get for free) to validate a stub's output against the tool's declared type, and later AI-generate a starter stub from the schema. (Idea borrowed from `mock-mcp`'s schema-as-contract approach; a third stub-*sourcing* strategy alongside hand-authored and recorded.)

## 10. Anti-goals (confirmed by surveying prior art)

- **No daemon / IPC / adapter / MCP-in-the-loop architecture** (as in `mock-mcp`). It violates NFR1 (friction is binary). Stay in-process.
- **No non-deterministic, AI-generated mocks in the core.** Our value is determinism for CI. AI/schema generation, if ever added, is an opt-in *authoring aid* that emits concrete stubs — never the runtime behavior.

---

## Appendix — illustrative API (non-binding; the plan pins exact signatures)

```ts
import { generateText } from "ai";
import { createHarness, wrapVercelTools, defineStubs } from "toolest"; // name TBD

const harness = createHarness({
  onUnhandled: "passthrough", // | "warn" | "error"
  stubs: defineStubs([
    { name: "get_weather", args: { city: "Paris" }, result: { tempC: 21 } }, // name+args
    { name: "search", match: (i) => i.q.includes("docs"), result: { hits: [] } }, // predicate
    { name: "flaky", result: () => { throw new Error("upstream 503"); } }, // error injection
    { name: "now", result: "2026-06-06T00:00:00Z" }, // name-only
  ]),
});

const result = await generateText({
  model, // user-supplied (real or MockLanguageModelV2)
  tools: wrapVercelTools(myTools, harness),
  prompt: "What's the weather in Paris?",
});

// assert with plain data
expect(harness.callsTo("get_weather")).toHaveLength(1);
expect(harness.trajectory[0]).toMatchObject({ name: "get_weather", stubbed: true });
```
