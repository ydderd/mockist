# mockist backlog

The forward-looking source of truth: shipped status, gates, roadmap, requirements, tech
debt, and the findings log. Why & how: [PRIMER.md](../PRIMER.md). Usage/API:
[README.md](../README.md). Design spec:
`docs/superpowers/specs/2026-06-06-declarative-tool-stub-harness-design.md`.

**Scope:** mockist's unit of test is the **agentic tool/skill call boundary** — did the
agent call the right tool/skill, with the right args, in the right order, and how did it
handle the result. What happens *inside* `execute` (HTTP/DB/queue I/O) is ordinary
implementation code, tested with existing tools (`vi.mock`, nock/MSW/Polly, testcontainers);
mockist explicitly does **not** go below the boundary. See [What NOT to build](#what-not-to-build).

---

## Shipped (M0 — boundary stub harness)

Delivered and dogfooded on Synapse (2026-06-08). API reference: [README.md](../README.md).

| Piece | Role |
|-------|------|
| `wrapVercelTools(tools, harness)` | Route every tool `execute` through the harness |
| `createHarness({ stubs, resolvers, onUnhandled })` | Declarative stubs + trajectory recording |
| `defineStubs([...])` | Name/export reusable stub lists (suite, fixture, test layers) |
| `harness.trajectory` / `callsTo` / `calledWith` / `reset()` | Assert tool-call order, args, outputs, errors |
| Sequential `sequence` stubs | Retry / failure-then-success flows |
| Layered registries | Merge stub arrays (test → fixture → suite); **first match wins** — no extra API |

### Done

1. **Package + dogfood against Synapse** (2026-06-08) — mockist is a consumable package
   (tsup build, `dist/` + `exports`, `"private"` dropped). Verified at runtime that
   `wrapVercelTools` interception holds on Synapse's model-driven workflow `AGENT_RUN`
   tool path, and tested an agent trajectory + stubbed tool-error injection with zero
   dependency mocking. Verdict: **CONTINUE (relief)**. Plan:
   `docs/superpowers/plans/2026-06-07-package-and-dogfood-synapse.md`. Full write-up in the
   [findings log](#findings-log).

   Key finding: boundary stubbing tests the *agent's tool use*, not a tool's internals —
   it complements (doesn't replace) dependency-mocked unit tests, and can't reach the
   origin-story bugs that live inside `execute`. This re-orders the roadmap below.

2. **Sequential / once stubs** (2026-06-09) — stubs can now define ordered `sequence`
   steps with `{ result }` or `{ error }` entries for retry, polling, pagination, and
   failure-then-success flows. Exhaustion defaults to a stubbed error, with opt-in
   `"repeat-last"` and `"passthrough"` modes.

3. **Terminology cleanup** (2026-06-10) — replaced "failure recovery" with "stubbed
   tool-error injection / recording" across PRIMER, the findings log, and this backlog.
   Scripted-model output proves error injection + continuation through the SDK loop; it
   does not prove a real model would choose to recover. Remaining precision work folds
   into per-feature docs as they ship.

4. **Trajectory assertion helpers + readable diffs** (2026-06-10) — runner-agnostic
   assertion core in `src/core/assert.ts`: `expectExactTrajectory`, `expectSubsequence`,
   `expectCalledTool`, `expectCalledWith` (deep-subset), `expectNoUnhandledCalls`,
   `expectNoPassthroughCalls`, `expectNoExhaustedSequences`. Each returns
   `{ pass, message() }` (no throw, no vitest import); failure messages render an
   expected-vs-actual diff with per-call name/input/output-or-error/stubbed. Also exposed
   `harness.sequenceState()` (see tech-debt item below). API: [README.md](../README.md#trajectory-assertion-helpers).

5. **Sub-agent / whole-workflow harness composition (v1)** (2026-06-19) — observe a
   multi-agent workflow's full tool/skill trajectory at the boundary. Pattern A: one shared
   `Harness` threaded through every `wrapVercelTools` (with `mergeStubs` for per-agent stub
   layers). Pattern B: `concatTrajectories` / `mergeHarnessTrajectories` to merge separate
   loops; `harness.recordCall("subagent", …)` for handoff markers. Spec:
   `docs/superpowers/specs/2026-06-14-subagent-workflow-composition-design.md`. API:
   [README.md](../README.md#multi-agent-workflows-sub-agents--handoffs). Deferred:
   `harness.fork()` (cassette cursor sharing); auto `kind: "subagent"` via adapters.

6. **SDK adapters (Claude Agent SDK, MCP, OpenAI)** (2026-06-19) — `createClaudeAgentHooks`,
   `wrapMcpHandlers` / `createMcpClientInterceptor`, `wrapOpenAiTools` /
   `createOpenAiToolInterceptor`. `harness.resolveCall` for hook-based interception. Spec:
   `docs/superpowers/specs/2026-06-19-sdk-adapters-design.md`. Gate: second-SDK reach
   (Claude hooks + MCP + OpenAI) passed in unit tests.

7. **Schema-grounded stubs** (2026-06-19) — `validateStubsAgainstSchemas`,
   `stubsFromSchemas`, `validateTrajectoryOutputs`, `placeholderFromSchema` against a JSON
   Schema subset.

8. **Runner integrations (Vitest/Jest matchers)** (2026-06-19) — `mockist/vitest-matchers`,
   `mockist/jest-matchers`: `toHaveCalledTool`, `toHaveToolTrajectory`,
   `toHaveNoUnhandledToolCalls`, etc., backed by `src/core/assert.ts`.

9. **GitHub Action + CI replay (v1)** (2026-06-19) — `.github/workflows/mockist-replay.yml`
   runs the test suite on PRs; `scripts/ci-trajectory-diff.mjs` formats failure output for PR
   comments. Deferred: cross-model replay (re-run scenarios with model swapped).

### Tech debt

- ~~**Sequence exhaustion is not queryable**~~ **(resolved 2026-06-10)** — `harness.sequenceState()`
  now returns `{ name, kind, length, consumed, exhausted }` per sequence stub; `registry.ts`
  tracks a per-stub drain counter so "ran dry" is distinguishable from "fully consumed". Powers
  `expectNoExhaustedSequences`.

---

## Gates

### Gate 1 — boundary stub harness (passed, 2026-06-08)

Prove agent **trajectory** tests feel like relief on a real repo.

- [x] `wrapVercelTools` for the Vercel AI SDK — wrap each `execute`.
- [x] `createHarness` + declarative stubs + `onUnhandled` policy + trajectory.
- [x] `defineStubs` + first-match-wins merge for suite/test layered registries.
- [x] Sequential stubs (`sequence: [{ error }, { result }]`) for retry flows.
- [x] **Dogfood (Synapse):** real `createWorkflowTools`, scripted model, zero prisma/queue
  mocks; stubbed external tools; assert ordered trajectory. Verdict: **continue**.

### Gate 2 — dependency replay (retired, 2026-06-14)

**Retired before starting.** This gate was going to prove that replaying recorded HTTP/DB
responses inside `execute` beats hand-mocks on a tool's *internals*. We cut it: that is
testing implementation internals, not the agentic boundary — it's ordinary unit testing,
already well served by `vi.mock` / nock / MSW / Polly / testcontainers, and chasing it pulls
mockist off its actual job (testing/stubbing agentic tool & skill calls). See
[What NOT to build](#what-not-to-build) and the [2026-06-14 scope decision](#2026-06-14--scope-decision-dependency-replay-cut).

The next gate **at the boundary** was reach — a second SDK adapter proving the
harness/recorder model generalizes. **Passed 2026-06-19** (Claude Agent SDK hooks, MCP, OpenAI
adapters — see [Done #6](#done)). Whole-workflow trajectory composition v1 shipped 2026-06-19
(see [Done #5](#done)). M2 items 4–7 shipped 2026-06-19 except cross-model CI replay (deferred
from [Done #9](#done)). Next: M3 hosted platform.

---

## Roadmap (post-M0, boundary-first)

Everything below keeps the unit of test at the **agentic tool/skill call boundary**: make
hand-authored boundary tests genuine relief (M1), then extend that same harness/recorder
model across more agent SDKs and across multi-agent workflows (M2), then host it (M3).

### M1 — Test ergonomics (the devex unlock)

1. ~~**Trajectory assertion helpers + readable diffs**~~ **(done 2026-06-10)** — runner-agnostic
   assertion core (`src/core/assert.ts`), no vitest import: exact trajectory, ordered
   subsequence, called tool, called-with partial input (deep-subset), no-unhandled,
   no-passthrough, no-exhausted-sequences. Each returns `{ pass, message() }`; failure
   messages render an expected-vs-actual diff with per-call name/input/output-or-error/stubbed.
   Closed the sequence-exhaustion tech-debt item via `harness.sequenceState()`. These power
   the later Vitest/Jest matchers (M2 item 6). See [Done #4](#done).
2. ~~**Record → replay (VCR/cassette)**~~ **(done 2026-06-13)** — capture real tool-boundary
   runs and replay them as hand-editable JSON cassettes. Cassette is a `HarnessOptions` field
   (resolver layered between stubs and custom resolvers, ahead of `onUnhandled`); record via
   `MOCKIST_RECORD` over the existing runner with an auto-save setup hook (Vitest + Jest);
   consume-once first-match replay; per-entry `match` directives + redaction-sentinel wildcards;
   coverage via `cassetteState()` / `expectCassetteFullyUsed`. Spec:
   `docs/superpowers/specs/2026-06-13-record-replay-cassettes-design.md`.

### M2 — Reach + reproducible in CI (PLG rung 3)

Extend the boundary harness across more agent SDKs and across multi-agent workflows, then
make boundary tests reproducible in CI. Same harness/recorder model, wider surface.

3. ~~**Sub-agent / whole-workflow harness composition**~~ **(done 2026-06-19)** — v1:
   `mergeHarnessTrajectories` / `concatTrajectories`, `harness.recordCall` for handoff
   markers, README patterns (shared harness + explicit merge). Spec:
   `docs/superpowers/specs/2026-06-14-subagent-workflow-composition-design.md`. See
   [Done #5](#done). Deferred: `harness.fork()`; auto `kind: "subagent"` via adapters.
4. ~~**More adapters**~~ **(done 2026-06-19)** — Claude Agent SDK (`createClaudeAgentHooks`),
   MCP (`wrapMcpHandlers`, `createMcpClientInterceptor`), OpenAI (`wrapOpenAiTools`). Spec:
   `docs/superpowers/specs/2026-06-19-sdk-adapters-design.md`. See [Done #6](#done).
5. ~~**Schema-grounded stubs and fixtures**~~ **(done 2026-06-19)** — `validateStubsAgainstSchemas`,
   `stubsFromSchemas`, `validateTrajectoryOutputs`. See [Done #7](#done).
6. ~~**Runner integrations**~~ **(done 2026-06-19)** — Vitest/Jest matchers via
   `mockist/vitest-matchers` and `mockist/jest-matchers`. See [Done #8](#done).
7. ~~**GitHub Action + cross-model replay**~~ **(CI v1 done 2026-06-19)** —
   `.github/workflows/mockist-replay.yml` + trajectory diff script. Cross-model replay deferred.
   See [Done #9](#done).

### M3 — Hosted (PLG rungs 3–4, the platform)

8. Upload cassettes/runs; audit trail; team dashboards; cross-model/version diffing as a
   service; suite gating.

---

## Decisions to make early

- **Language/dist:** TS-first (matches the SDKs); ship as an npm package + CLI. Python
  adapter later if pulled.
- **Adapter ergonomics:** how close to truly one-line can each SDK wrapper get
  (`wrapVercelTools` and its Claude/MCP/OpenAI siblings)? Friction at the boundary
  determines adoption (see PRIMER risk #4).
- **Secret redaction on capture:** non-negotiable before any upload tier; design it into
  the cassette recorder (shipped in M1).
- **Scope discipline (boundary-first):** the differentiator is being **the zero-spec
  test/stub harness for the agentic tool & skill boundary** — derived from the SDK tool
  defs you already wrote, working the same way across every agent SDK and across multi-agent
  workflows. Stay at the boundary: do **not** drift below it into dependency replay / DB-HTTP
  stubbing (crowded, and it's regular unit testing), and do **not** drift sideways into
  "another eval dashboard" (hosted traces, LLM-judge-first).

## What NOT to build

- **Dependency replay / generic DB/HTTP stubbing inside `execute`.** Stubbing or replaying
  the I/O a tool performs internally (fetch/Prisma/queue) is testing implementation
  internals, not the agentic boundary. It is ordinary unit testing — already well served by
  `vi.mock`, nock/MSW/Polly, and testcontainers — and it duplicates a crowded space while
  pulling mockist off its actual job. If you own `execute`, unit-test it directly with those
  tools. (Retired [Gate 2](#gate-2--dependency-replay-retired-2026-06-14); see the
  [2026-06-14 scope decision](#2026-06-14--scope-decision-dependency-replay-cut).)
- A capability-spec DSL (the tool def is the spec — ingest it).
- A generic prompt/eval playground (overlaps incumbents).
- MCP-only scope (it's one adapter, not the product).

---

## Findings log

### 2026-06-14 — Scope decision: dependency replay cut

Decided to **retire dependency replay inside `execute`** (the former Gate 2 / M2 moat) and
fix mockist's scope at the **agentic tool/skill call boundary**.

**Why.** Mockist's job is to let developers test and stub the tool/skill calls an agent makes
in their app — *did the model call the right tool, with the right args, in the right order,
and handle the result*. Replaying the HTTP/DB/queue I/O a tool does *inside* `execute` is a
different job: testing implementation internals. That is ordinary unit testing, and it is
already well served by `vi.mock`, nock/MSW/Polly, and testcontainers. If you own `execute`,
you unit-test it directly. Building a mockist-native dependency-replay layer would duplicate
a crowded space and pull the product off the one thing it is uniquely good at.

This reverses the 2026-06-08 reprioritization (below), which had promoted "dependency replay
inside `execute`" to a first-class moat item. The 2026-06-08 *observation* still stands —
boundary stubbing genuinely cannot see bugs inside `execute` — but the *conclusion* changed:
that gap is intentional and out of scope, not a thing for mockist to close.

**Consequences.** Gate 2 retired; former M2 (dependency replay v1/v2) removed; sub-agent /
whole-workflow trajectory composition promoted into the new boundary-level M2 (reach + CI).
New differentiator stated under [Decisions to make early](#decisions-to-make-early): the
zero-spec test/stub harness for the agentic tool & skill boundary, across every agent SDK.
PRIMER.md and README.md updated to match.

### 2026-06-08 — Synapse dogfood (verdict: CONTINUE — relief, not ceremony)

Branch: mockist `feat/tool-stub-harness`; Synapse `dogfood/mockist-workflow-tools` (commit
`b344b83`, not for merge). Outcome of Priority-1 work (plan:
`docs/superpowers/plans/2026-06-07-package-and-dogfood-synapse.md`): packaged mockist,
linked it into Synapse, **verified the interception shape holds at runtime**, and
dogfooded a workflow agent-step trajectory.

**Verdict: CONTINUE (relief, not ceremony).** For the use case it targets — asserting an
agent's **tool-call trajectory and stubbed tool-error injection** on the model-driven path
— mockist is a clear win in Synapse. It produced an agent test with **zero dependency
mocking** at a natural chokepoint Synapse already wraps. It does **not** replace Synapse's
existing dependency-mocked unit tests; it tests a *different* thing they don't cover today.

**Shape verified? YES.** `tests/unit/mockist-shape-check.test.mts` is a runtime proof (not
a static trace): wrap the **real** `createWorkflowTools(...)` output with `wrapVercelTools`,
drive it with a scripted `MockLanguageModelV3`, and the stubbed call is recorded
(`stubbed: true`) while the tool's real prisma-backed `execute` is confirmed **never
called** (`vi.spyOn(...).not.toHaveBeenCalled()`). A non-vacuous probe (non-matching stub
name) confirmed the assertions discriminate. This holds because the tool set passes by
reference all the way to the `ai` SDK (`router.ts:170` → `metered.ts:212`/`300`), and
Synapse already relies on execute-wrapping surviving this path
(`orchestrator-adapter.ts:187–237`, `wrapToolWithEvents`).

**What worked:**

- **Trajectory assertions over real tools, no mocks.**
  `tests/unit/dogfood-mockist-workflow.test.mts` asserts an ordered multi-tool trajectory
  (`context_recall` → `read_ontology`) and a stubbed tool-error path (a stubbed tool throws;
  the scripted model proceeds to its next pre-scripted call; the error is recorded on the
  trajectory — this validates error *recording*, not the model genuinely *deciding* to
  recover) against the real `createWorkflowTools` set, with **no** `vi.mock('@/lib/prisma',
  …)` and no queue mock. Because every tool is stubbed, the internal deps never run, so no
  DB/Redis is needed.
- **Natural fit with existing code.** mockist's `wrapVercelTools` is the same shape as
  Synapse's own `wrapToolWithEvents`; it slots into the `orchestrator-adapter.ts`
  chokepoint and composes with the existing wrapper.
- **Adapter is generate-fn agnostic.** It wraps the tool set, so it doesn't care that
  Synapse calls tools via `llmRouter.generateWithTools` / `meteredStreamTextSimple` rather
  than raw `generateText`.

**What boundary stubbing could NOT do (the gap):**

- **It can't test a tool's own internals.** Stubbing a tool at the boundary replaces its
  entire `execute`, so it cannot exercise the tool's own prisma/queue logic. Synapse's
  existing unit tests (`crm-tools.test.mts`, `email-compose.test.mts`, …) that mock prisma
  to test `execute` internals test a *different* thing — mockist does **not** replace them.
  Boundary stubbing (trajectory) and dependency mocking (internals) are complementary.
- The Synapse origin-story bugs (PRIMER) lived **inside** `execute` (prisma/queue/Gmail) —
  exactly what boundary stubbing can't reach.

**Coverage gaps hit:**

- **Workflow-engine steps are out of scope.** `CONDITION`/`TRANSFORM`/`WAIT`/
  `CONTEXT_WRITE`/`OBSERVE`/`HUMAN_GATE` (in `lib/queue/workers/workflow-engine.ts`) call
  prisma/queue/notifications directly — never through a Vercel `tool()` — so there's no
  `execute` boundary to wrap.
- **Sub-agent boundary (v1 addressed).** Each agent loop still has its own tool set; v1
  covers whole-workflow trajectories via a shared harness (Pattern A) or explicit merge +
  `recordCall` handoff markers (Pattern B). See README and [Done #5](#done). Still open:
  `harness.fork()` for cassette cursor sharing; automatic sub-agent markers via adapters.
- **`send_email` isn't a Vercel `tool()`** — it's a custom `IntegrationSkillDef`, so the
  current adapter doesn't cover it.
- **Verification fidelity.** The shape check is at the tool-factory level, not a full
  workflow-engine run (the `AGENT_RUN` path has no injectable test model and needs
  BullMQ/Redis). A higher-fidelity check via the streaming orchestrator's
  `context.testModel` + `meteredStreamTextSimple`'s `mock-provider` bypass is the next
  verification rung (not done).
- **Lockfile churn.** `npm install file:../` in Synapse caused sizable
  `package-lock.json` churn (npm re-resolving a stale lockfile). Fine for the throwaway
  dogfood branch; would need a clean lockfile before any real integration.

**Reprioritization from this dogfood:** "dependency replay inside `execute`" is a
*separate* capability (the moat for origin-story bugs), not the next adapter increment; and
sub-agent / whole-workflow harness composition became a first-class roadmap item.
