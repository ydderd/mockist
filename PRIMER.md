# mockist — Primer

> A test harness for agent **tools and skills**: stub or replay tool calls at clear
> boundaries, record trajectories, and assert on what the agent did — derived from
> the tool definitions you already wrote, with near-zero added effort.

**Status:** **shipped** for **tool-boundary** stubbing, record → replay, and multi-agent
workflow composition v1 (`wrapVercelTools`, `createHarness`, trajectory assertions,
hand-editable JSON cassettes, `mergeHarnessTrajectories` / `concatTrajectories`,
`harness.recordCall`). Next, all at the boundary: more SDK adapters; runner matchers; CI
replay. **Scope:** mockist tests the **agentic tool/skill call boundary**, not the I/O
*inside* `execute` (that's ordinary unit testing — see [`docs/BACKLOG.md`](./docs/BACKLOG.md)
"What NOT to build"). Usage: [README.md](./README.md). Roadmap, gates & findings:
[`docs/BACKLOG.md`](./docs/BACKLOG.md).

---

## The problem

When you build an agent, you hand an SDK a list of tools and let a model call them. You do **not** reliably see, track, or regression-test those tool calls. Today's options are bad:

- **Hand-written unit tests** mock the tool's dependencies (DB, HTTP, other tools) by hand. They're brittle, they drift, and — the killer — **they pass while the real behavior is wrong**, because the mock encodes your assumption, not reality.
- **Eval/trace platforms** (LangSmith, Langfuse, Braintrust, Arize, Promptfoo) trace runs and score model output, but they don't give you a *deterministic, dependency-mocked replay* of a specific tool/skill that you can run as a fast unit/CI test.
- **MCP test fakes** (e.g. `mock-mcp`) fake a *server* so you can test a *client*. Useful, but it's one tile, and it's still hand-authored.

Net: the tool/skill — the part that actually touches your systems and the part the model gets wrong — is the least-tested unit in the stack.

### Field evidence (the origin story)

This idea came out of shipping a tenant email-sending + CRM feature (Synapse PR #204). Every skill/tool test hand-mocked `prisma`, the job queue, and the Gmail client. The unit suite was green — yet a code-review bot found **five rounds** of real bugs the mocks structurally could not see: broken BullMQ retries, non-atomic claims causing double-sends, an orphaned in-flight status, cross-tenant mailbox mis-attribution, and a post-send failure that resent already-delivered mail. Those were all **inside-`execute`** dependency/runtime-contract bugs — squarely unit-testing territory, and explicitly **out of scope** for mockist (see the backlog's "What NOT to build"). What the origin story exposed for mockist is the *other* untested half: nobody was regression-testing **which tools/skills the agent actually called, with what args, in what order** — the boundary mockist owns.

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
behavior := from recorded real runs (tool name, args, model choice, result/error)
tests    := promoted from those recordings, not hand-written
```

The loop is **record → replay → assert** at the tool boundary — shipped today via
hand-editable JSON cassettes. Hand-authored stubs remain for the cases you'd rather write
than record.

---

## What it is / what it isn't

**Is (shipped):** a thin wrapper around your SDK tools — stub whole `execute` calls,
record every call in order, assert trajectories, record → replay runs as hand-editable JSON
cassettes, and observe multi-agent workflows (one shared harness or explicit trajectory
merge + handoff markers). Two lines: `createHarness` + `wrapVercelTools`. Suite-wide defaults
and per-test overrides via merged stub lists (see README — **layered stub registries**).

**Is (next):** the same boundary harness across more agent SDKs (Claude Agent SDK, MCP,
OpenAI), plus runner matchers and CI replay. Deferred from composition v1: `harness.fork()`
and automatic sub-agent markers via adapters.

**Isn't:** a dependency-replay / DB-HTTP-queue mocking layer for code *inside* `execute`
(that's ordinary unit testing — out of scope); a new spec format; another generic
LLM-eval/trace dashboard; an MCP-only thing.

### Two test tiers (mockist owns tier 2)
1. **Tool-as-code** — given args, does `execute()` do the right thing + the right side effects? **Out of scope** — this is unit testing, served by `vi.mock` / nock / MSW / testcontainers; if you own `execute`, test it directly.
2. **Tool-under-agent** — given a prompt + tools, does the *model* call the right tools, with valid args, and handle errors? (trajectory + boundary record/replay — **shipped** via `wrapVercelTools` + `harness.trajectory` + cassettes). MCP-as-contract (does a server expose the tools/schemas it claims) is the same tier through a future adapter.

**This is the product:** tier 2 — fast, no dependency mocking, validated in the Synapse
dogfood (see the findings log in [`docs/BACKLOG.md`](./docs/BACKLOG.md)).

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

**Shipped (record → replay cassettes) + next (more adapters):**

```
                ┌───────────▼───────────┐      ┌──────────────────────┐
                │  Interceptor           │─────▶│ Recorder (cassette)   │  record mode
                │  - wraps execute()     │      └──────────────────────┘
                │    at the tool boundary│◀─────┐
                └───────────┬───────────┘      │ Replayer (cassette source) replay mode
                            │                   └──────────────────────┘
                ┌───────────▼───────────┐
                │  Adapters (ingest)     │  vercel-ai · (next: claude · mcp · openai)
                └────────────────────────┘
                ┌────────────────────────┐
                │  Runner / assert / diff │  assertion core + (next: vitest/jest matchers)
                └────────────────────────┘
```

- **Shipped adapter:** `wrapVercelTools` — Vercel AI SDK only; tools are `execute`-wrapped objects.
- **Future adapters** normalize each SDK's tool list into the same boundary harness/recorder.
- **Test ergonomics:** layered stub registries (README) — project-level `mergeStubs` helpers;
  mockist stays runner-agnostic.

### Core model

Three concepts, nothing more:

- **Tool** — ingested, never authored. From a Vercel AI SDK `tool()`, an MCP `tools/list` entry, or an OpenAI/Anthropic tool def. Gives us `name`, `description`, input/output JSON-Schema.
- **Recording** — one captured tool-boundary invocation: `{ tool, args, modelChoice?, result|error, ts, meta(model, repo, sha) }`. Hand-editable JSON cassette on disk; uploadable later.
- **Scenario** — a named test derived from one or more recordings: `given` (the tool outputs to replay) → `when` (called-with-args, or agent-given-prompt) → `then` (assert tool-call trajectory / outputs). Generated from recordings; hand-editable.

The loop: **record → replay → assert/diff** at the tool boundary — shipped via cassettes.
Hand-authored boundary stubs cover the cases you'd rather write than record.

Deliberately **not** built: a dependency seam *inside* `execute` (keyed DB/HTTP/queue
interception). That's implementation-internals unit testing — use `vi.mock` / nock / MSW /
testcontainers. mockist stays at the SDK tool boundary.

---

## Wedge & distribution (PLG ladder)

The free, solo-dev rung must stand alone and be *relief, not ceremony*:

1. **`wrapVercelTools()` + `createHarness()`** (free, local, **shipped**) — stub tool
   boundaries, see every call, assert trajectories. Layered suite/test stub registries
   need no extra API (merge stub arrays; first match wins).
2. **Record → cassettes** (**shipped**) — freeze real tool-boundary calls (args + outcome)
   to a hand-editable JSON cassette and replay them deterministically.
3. **Replay in CI / a GitHub Action** — run the cassette/trajectory suite on PRs, diff,
   gate on regressions. **Next.**
4. **Hosted run-suites** — audit trails, cross-model diffing, team gates, dashboards.
   **Future platform.**

Rung 1 is the adoption hook and must be genuinely useful with no account — Synapse
dogfood verdict: **relief, not ceremony** for agent trajectory tests.

---

## Honest risks (decide before investing)

1. **The deterministic half is low-value** — SDKs already validate args against the schema; MCP is typed. Don't sell schema-checking.
2. **The space around it is crowded** — eval/trace platforms (LangSmith/Braintrust/Langfuse/Promptfoo/Arize) also observe tool calls. mockist differentiates by staying a *zero-spec, in-repo unit-test harness* derived from your SDK tool defs — fast, deterministic, no account, no dashboard — not a hosted trace/eval product.
3. **Defensibility without a deep moat** — by deliberately staying at the boundary (no dependency replay), differentiation is breadth + ergonomics (every agent SDK, one-line wrap, runner-agnostic assertions, hand-editable cassettes), not a hard-to-build primitive. The bet: the boundary harness is the genuinely-missing reusable test layer, and being best-in-class at it across SDKs is enough.
4. **Friction is binary** — if instrumentation isn't truly one line per SDK, it's dead.
5. **User ≠ buyer** — solo dev adopts free; the team needing CI gates/audit pays. The free tier must be painfully useful first.

---

## Verdict

There's probably something — and the sharp version is **"the zero-spec test/stub harness for the agentic tool & skill boundary — derived from the SDK tool defs you already wrote and from real runs, working the same way across every agent SDK and across multi-agent workflows."** Not a spec DSL, not a dependency-mock layer, not another eval dashboard.

**Gate (2026-06-08):** boundary stub harness on the Vercel AI SDK — **continue**. Agent
trajectory + stubbed tool-error injection (a stubbed tool throws; the error is recorded on
the trajectory) on Synapse's real `createWorkflowTools` path with zero `vi.mock` of
prisma/queue. (The dogfood drove a scripted model, so this validates error *recording*, not
the model genuinely *deciding* to recover after seeing an error.) **Gate (2026-06-19):**
sub-agent / whole-workflow trajectory composition v1 — **passed** (`mergeHarnessTrajectories`,
`concatTrajectories`, `harness.recordCall`; shared-harness and explicit-merge patterns in
README). **Next gate (all at the boundary):** a second SDK adapter (Claude Agent SDK / MCP /
OpenAI) proving the harness/recorder model generalizes. Dependency replay inside `execute` is
explicitly **not** a gate — see the backlog's 2026-06-14 scope decision.

---

## Open references to ground before building
- Compare the convergent tool shape against real agent frameworks (Hermes/Nous function-calling format, MCP `tools/list`, OpenAI/Anthropic tool schemas) — confirm the ingest layer covers them.
- Survey what LangSmith / Braintrust / Langfuse / Promptfoo / Arize already capture, to sharpen the "in-repo, zero-spec boundary harness is the gap" claim (and confirm they don't already make boundary unit-testing trivial).
- `mock-mcp` (github.com/mcpland/mock-mcp) for the MCP-server-fake tile.
