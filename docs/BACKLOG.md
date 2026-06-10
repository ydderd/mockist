# mockist backlog

The forward-looking source of truth: shipped status, gates, roadmap, requirements, tech
debt, and the findings log. Why & how: [PRIMER.md](../PRIMER.md). Usage/API:
[README.md](../README.md). Design spec:
`docs/superpowers/specs/2026-06-06-declarative-tool-stub-harness-design.md`.

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

### Tech debt

- **Sequence exhaustion is not queryable** — the harness *acts* on exhaustion (`error` /
  `repeat-last` / `passthrough`, `registry.ts`) but exposes no public API to ask whether a
  given sequence ran dry. Fold into the assertion-helpers item (M1).

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

### Gate 2 — dependency replay (not started; follows the M1 devex rungs)

The moat gate, taken **after** M1's ergonomics ship. Tier 1, HTTP-only deps first. Prove
replay beats hand-mocks on tool **internals** (Synapse email skills origin-story bugs).

- [ ] Dependency seam for **HTTP**: `recordedFetch` — log `(method+url+bodyHash) → response`;
  replay returns recorded response (throws on miss).
- [ ] Recorder: append `{tool, args, dependencyCalls, result, error}` to fixture files.
- [ ] `replay(tool, fixture)`: inject recorded HTTP responses, run `execute(args)`, diff.
- [ ] Vitest matcher or helper for fixture replay assertions.
- [ ] **Dogfood:** Synapse email skills — capture real `send_email` run; replay; break code;
  confirm replay catches what hand-mocks missed (e.g. double-send-after-post-send-failure).

**Kill/continue for gate 2:** if replacing hand-mocks on *internals* feels like relief,
build out M2 below (Prisma/DB/queue seams). If ceremony, document why and keep the
ergonomics layer (M0 + M1) as the product — it stands alone.

---

## Roadmap (post-M0, devex-first)

Test ergonomics ahead of the dependency-replay moat — each rung is independently useful,
making hand-authored tests genuine relief before we take on the hard captured-fixture
engineering.

### M1 — Test ergonomics (the devex unlock)

1. **Trajectory assertion helpers + readable diffs** — keep the core runner-agnostic, but
   add assertion functions that can power Vitest/Jest matchers later. Target common
   expectations: exact trajectory, ordered subsequence, called tool, called with partial
   input, no unhandled calls, no passthrough calls. Failure messages should show expected
   vs actual calls with name, input, output/error, and `stubbed` status. This is the next
   developer-experience unlock: today users manually inspect `harness.trajectory`. Also
   closes the sequence-exhaustion tech-debt item (expose exhaustion state).
2. **Record → replay (VCR/cassette)** — capture real tool-boundary runs and generate
   hand-editable stubs. Additive via the existing extension seams (`identify` / `Call`
   record / resolver pipeline / redaction hook). Deterministic JSON fixtures, redaction
   before disk write, fixture loading as stubs, update/approve workflow, clear
   missing/extra call diffs.

### M2 — Dependency replay (the moat) — Gate 2

3. **Dependency replay v1: fetch/HTTP inside `execute`** — begin the moat. Boundary
   stubbing tests whether the agent called the right tool; dependency replay tests whether
   the tool implementation behaves correctly. Start with an explicit
   `mockistFetch(fetch, harness)` seam that records method, URL, body hash/body, status,
   headers, and response body, then replays without network and fails on unrecorded HTTP
   calls in replay mode. Dependency calls attach to the parent tool call.
4. **Dependency replay v2: Prisma / DB / queue / MCP clients** — after HTTP proves the
   replay model, add explicit seams for common stateful dependencies. This is the
   capability that catches origin-story bugs inside `execute`: retries, non-atomic claims,
   duplicate side effects, cross-tenant lookups, and post-side-effect failures.
5. **Sub-agent / whole-workflow harness composition** *(from the dogfood)* — one harness
   only observes the tool set it wrapped, and each sub-agent / handoff runs its own loop.
   Provide a way to attach one harness across the sub-agent boundary, or merge trajectories
   from multiple harnesses, so a whole workflow's trajectory is observable.

### M3 — Reach + reproducible in CI (PLG rung 3)

6. **More adapters** — Claude Agent SDK (tools, skills, AND sub-agents all flow through the
   `tool_name` path: PreToolUse `deny` + PostToolUse `updatedToolOutput`); MCP; OpenAI.
   Keep adapters thin: normalize tool definitions and route calls into the same
   harness/recorder model.
7. **Schema-grounded stubs and fixtures** — validate stub output against the tool's JSON
   Schema where available; optionally generate starter stubs from schema. Prevents fake
   fixtures from drifting away from real tool contracts. Not the main value prop — SDKs
   already do a lot of input validation.
8. **Runner integrations** — optional Vitest/Jest matchers such as `toHaveCalledTool`,
   `toHaveToolTrajectory`, `toHaveNoUnhandledToolCalls`, backed by the runner-agnostic
   assertion core. Later than assertion helpers so the library doesn't become
   test-runner-shaped too early.
9. **GitHub Action + cross-model replay** — run the fixture suite on PRs; comment a diff;
   gate on regressions. Re-run scenarios with the model swapped.

### M4 — Hosted (PLG rungs 3–4, the platform)

10. Upload fixtures/runs; audit trail; team dashboards; cross-model/version diffing as a
    service; suite gating.

---

## Decisions to make early

- **Language/dist:** TS-first (matches the SDKs); ship as an npm package + CLI. Python
  adapter later if pulled.
- **Dependency seam ergonomics:** how close to truly one-line can the common wrappers get?
  This determines adoption (see PRIMER risk #4).
- **Secret redaction on capture:** non-negotiable before any upload tier; design it into
  the recorder from M1.
- **Scope discipline (devex-first):** M0 + M1 (boundary stubs, assertion helpers,
  record→replay) are the adoption wedge — make hand-authored tests genuine relief before
  the hard part. Tier-1 dependency replay (M2) is the differentiator and moat. Resist
  becoming "another eval dashboard" (hosted traces, LLM-judge-first) without replay
  underneath.

## What NOT to build

- A capability-spec DSL (the tool def is the spec — ingest it).
- A generic prompt/eval playground (overlaps incumbents).
- MCP-only scope (it's one adapter, not the product).

---

## Findings log

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
- **Sub-agent boundary.** Each agent / handoff sub-agent runs its own `generateWithTools`
  loop with its own tool set; one harness only observes the tool set it wrapped. Watching a
  whole multi-agent workflow with a single trajectory needs the harness applied at each
  assembly point. → roadmap item 5.
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
