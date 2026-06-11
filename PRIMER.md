# mockist — Primer

> A test harness for agent **tools and skills**: stub or replay tool calls at clear
> boundaries, record trajectories, and assert on what the agent did — derived from
> the tool definitions you already wrote, with near-zero added effort.

**Status:** **MVP shipped** for tier-2 **tool-boundary** stubbing (`wrapVercelTools`,
`createHarness`, trajectory assertions). **Record → replay** and **dependency replay
inside `execute`** are backlog (the long-term moat). Usage: [README.md](./README.md).
Roadmap, gates & findings: [`docs/BACKLOG.md`](./docs/BACKLOG.md).

---

## The problem

When you build an agent, you hand an SDK a list of tools and let a model call them. You do **not** reliably see, track, or regression-test those tool calls. Today's options are bad:

- **Hand-written unit tests** mock the tool's dependencies (DB, HTTP, other tools) by hand. They're brittle, they drift, and — the killer — **they pass while the real behavior is wrong**, because the mock encodes your assumption, not reality.
- **Eval/trace platforms** (LangSmith, Langfuse, Braintrust, Arize, Promptfoo) trace runs and score model output, but they don't give you a *deterministic, dependency-mocked replay* of a specific tool/skill that you can run as a fast unit/CI test.
- **MCP test fakes** (e.g. `mock-mcp`) fake a *server* so you can test a *client*. Useful, but it's one tile, and it's still hand-authored.

Net: the tool/skill — the part that actually touches your systems and the part the model gets wrong — is the least-tested unit in the stack.

### Field evidence (the origin story)

This idea came out of shipping a tenant email-sending + CRM feature (Synapse PR #204). Every skill/tool test hand-mocked `prisma`, the job queue, and the Gmail client. The unit suite was green — yet a code-review bot found **five rounds** of real bugs the mocks structurally could not see: broken BullMQ retries, non-atomic claims causing double-sends, an orphaned in-flight status, cross-tenant mailbox mis-attribution, and a post-send failure that resent already-delivered mail. Every one was a **dependency/runtime-contract** behavior. A harness that replayed real dependency responses against a "dispatch under retry" scenario would have caught most of them.

---

## The key reframe (what changed after first pass)

**Do not invent a capability-spec DSL.** Developers don't describe tools declaratively — they pass a tools array to an SDK. The tool definition **already is** the spec:

| Surface | Shape |
|---|---|
| Vercel AI SDK | `tool({ description, parameters: zodSchema, execute })` |
| Anthropic SDK | `{ name, description, input_schema }` |
| OpenAI | `{ type: 'function', function: { name, description, parameters } }` |
| MCP | `listTools()` → `{ name, description, inputSchema }` |

They converge on `name + description + JSON-Schema params + execute()`. The envelope differs; the primitive doesn't. So **mockist ingests what already exists** (reflection over the tools array / MCP `listTools`) — it never asks the dev to author a new spec.

The artifact mockist *generates* is not a spec — it's **captured runs → fixtures**:

```
schema   := from the SDK tool definition (free)
behavior := from recorded real runs (args, model choice, dependency I/O, result)
tests    := promoted from those recordings, not hand-written
```

The long-term loop is **record → replay → assert**. Today's MVP uses **hand-authored
stubs** at the tool boundary (no spec language); record → fixture generation is backlog.

---

## What it is / what it isn't

**Is (shipped):** a thin wrapper around your SDK tools — stub whole `execute` calls,
record every call in order, assert trajectories. Two lines: `createHarness` +
`wrapVercelTools`. Suite-wide defaults and per-test overrides via merged stub lists
(see README — **layered stub registries**).

**Is (planned):** "VCR + Pact, for agent tool calls" at the **dependency seam inside
`execute`** — record DB/HTTP/MCP I/O, replay deterministically. Complements boundary
stubbing; does not replace hand-mocked unit tests of tool internals.

**Isn't:** a new spec format; another generic LLM-eval/trace dashboard; an MCP-only thing.

### Three test tiers (you opt into depth)
1. **Tool-as-code** — given args, does `execute()` do the right thing + the right side effects? (dependency replay inside `execute` — **backlog / moat**)
2. **Tool-under-agent** — given a prompt + tools, does the *model* call the right tools, with valid args, and recover from errors? (trajectory assertion — **shipped** via boundary stubs + `harness.trajectory`)
3. **MCP-as-contract** — does the server expose the tools/schemas it claims and behave per recorded scenarios? (**future adapter**)

**Shipped first:** tier 2 — fast, no dependency mocking, validated in the Synapse dogfood
(see the findings log in [`docs/BACKLOG.md`](./docs/BACKLOG.md)). **Differentiated
long-term:** tier 1 dependency replay — what catches the origin-story bugs boundary
stubbing cannot see.

---

## How it works

**Shipped (M0 — boundary stub harness):**

```
  your code │  tools = wrapVercelTools(myTools, harness)     ← 2-line opt-in
            │  harness = createHarness({ stubs: mergeStubs(test, suite) })
            └───────────────┬─────────────────────────────┘
                            │ every execute() call
                ┌───────────▼───────────┐
                │  Harness.dispatch      │  stub match → canned result / throw
                │  - predicateResolver   │  miss → pass-through / warn / error
                │  - recorder (trajectory)│
                └────────────────────────┘
```

**Planned (record + dependency replay):**

```
                ┌───────────▼───────────┐      ┌──────────────────────┐
                │  Interceptor           │─────▶│ Recorder (JSONL sink) │  record mode
                │  - wraps execute()     │      └──────────────────────┘
                │  - wraps dep clients   │◀─────┐
                └───────────┬───────────┘      │ Replayer (fixture source)  replay mode
                            │                   └──────────────────────┘
                ┌───────────▼───────────┐
                │  Adapters (ingest)     │  vercel-ai · mcp · openai · anthropic
                └────────────────────────┘
                ┌────────────────────────┐
                │  Runner / assert / diff │  CLI + vitest/jest matchers
                └────────────────────────┘
```

- **M0 adapter:** `wrapVercelTools` — Vercel AI SDK only; tools are `execute`-wrapped objects.
- **Future adapters** normalize each SDK's tool list; dependency clients wrapped for record/replay.
- **Test ergonomics:** layered stub registries (README) — project-level `mergeStubs` helpers;
  mockist stays runner-agnostic.

### Core model

Three concepts, nothing more:

- **Tool** — ingested, never authored. From a Vercel AI SDK `tool()`, an MCP `tools/list` entry, or an OpenAI/Anthropic tool def. Gives us `name`, `description`, input/output JSON-Schema.
- **Recording** — one captured invocation: `{ tool, args, modelChoice?, dependencyCalls: [{key, request, response|error}], result|error, ts, meta(model, repo, sha) }`. JSONL on disk; uploadable later.
- **Scenario** — a named test derived from one or more recordings: `given` (the dependency responses to inject) → `when` (called-with-args, or agent-given-prompt) → `then` (assert output / tool-call trajectory / observed side-effect calls). Generated from recordings; hand-editable.

The long-term loop: **record → promote to scenario → replay → assert/diff.** M0 uses
hand-authored boundary stubs instead of recorded fixtures.

The hard primitive (backlog): a **dependency seam** inside `execute` — a keyed,
interceptable boundary for DB/HTTP/MCP I/O. Recording captures `(key, request) →
response`; replay injects the recorded response instead of hitting the real dependency.
M0 stubs the whole `execute` at the SDK tool boundary (complementary, not a substitute).

---

## Wedge & distribution (PLG ladder)

The free, solo-dev rung must stand alone and be *relief, not ceremony*:

1. **`wrapVercelTools()` + `createHarness()`** (free, local, **shipped**) — stub tool
   boundaries, see every call, assert trajectories. Layered suite/test stub registries
   need no extra API (merge stub arrays; first match wins).
2. **Record → fixtures** — freeze real calls (args + dependency responses + outcome) to
   a file. **Backlog.**
3. **`replay` in tests / CI / a GitHub Action** — deterministic re-run + diff. **Backlog**
   (depends on rung 2).
4. **Hosted run-suites** — audit trails, cross-model diffing, team gates, dashboards.
   **Future platform.**

Rung 1 is the adoption hook and must be genuinely useful with no account — Synapse
dogfood verdict: **relief, not ceremony** for agent trajectory tests.

---

## Honest risks (decide before investing)

1. **The deterministic half is low-value** — SDKs already validate args against the schema; MCP is typed. Don't sell schema-checking.
2. **The non-deterministic half is crowded** — tier-2 trajectory tooling overlaps
   LangSmith/Braintrust/Langfuse/Promptfoo/Arize. M0 ships there as the free wedge; the
   pitch can't stop at trajectory-only if we want a moat.
3. **Dependency replay is the moat and the hard part** — capturing/replaying arbitrary DB/HTTP/MCP I/O deterministically is real engineering.
4. **Friction is binary** — if instrumentation isn't truly one line per SDK, it's dead.
5. **User ≠ buyer** — solo dev adopts free; the team needing CI gates/audit pays. The free tier must be painfully useful first.

---

## Verdict

There's probably something — but the sharp version is **"zero-spec VCR + contract tests for agent tool calls, derived from your SDK tools and real runs, anchored on dependency replay."** Not a spec DSL, not another eval dashboard.

**Gate (2026-06-08):** boundary stub harness on the Vercel AI SDK — **continue**. Agent
trajectory + stubbed tool-error injection (a stubbed tool throws; the error is recorded on
the trajectory) on Synapse's real `createWorkflowTools` path with zero `vi.mock` of
prisma/queue. (The dogfood drove a scripted model, so this validates error *recording*, not
the model genuinely *deciding* to recover after seeing an error.) **Next gate for the original thesis:** dependency replay
inside `execute` on the Synapse email skills — inject recorded HTTP/DB responses, re-run
the tool, diff; see if it beats hand-mocks on the origin-story bugs.

---

## Open references to ground before building
- Compare the convergent tool shape against real agent frameworks (Hermes/Nous function-calling format, MCP `tools/list`, OpenAI/Anthropic tool schemas) — confirm the ingest layer covers them.
- Survey what LangSmith / Braintrust / Langfuse / Promptfoo / Arize already capture, to sharpen the "dependency replay is the gap" claim.
- `mock-mcp` (github.com/mcpland/mock-mcp) for the MCP-server-fake tile.
