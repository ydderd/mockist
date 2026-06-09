# mockist — Synapse dogfood findings & gate decision

Date: 2026-06-08. Branch: mockist `feat/tool-stub-harness`; Synapse `dogfood/mockist-workflow-tools` (commit `b344b83`, not for merge).

Outcome of Priority-1 work (plan: `docs/superpowers/plans/2026-06-07-package-and-dogfood-synapse.md`): packaged mockist, linked it into Synapse, **verified the interception shape holds at runtime**, and dogfooded a workflow agent-step trajectory.

## Verdict: CONTINUE (relief, not ceremony)

For the use case it targets — asserting an agent's **tool-call trajectory and failure recovery** on the model-driven path — mockist is a clear win in Synapse. It produced an agent test with **zero dependency mocking** at a natural chokepoint Synapse already wraps. It does **not** replace Synapse's existing dependency-mocked unit tests; it tests a *different* thing they don't cover today.

## Shape verified? YES

`tests/unit/mockist-shape-check.test.mts` is a runtime proof (not a static trace): wrap the **real** `createWorkflowTools(...)` output with `wrapVercelTools`, drive it with a scripted `MockLanguageModelV3`, and the stubbed call is recorded (`stubbed: true`) while the tool's real prisma-backed `execute` is confirmed **never called** (`vi.spyOn(...).not.toHaveBeenCalled()`). A non-vacuous probe (non-matching stub name) confirmed the assertions discriminate. This holds because the tool set passes by reference all the way to the `ai` SDK (`router.ts:170` → `metered.ts:212`/`300`), and Synapse already relies on execute-wrapping surviving this path (`orchestrator-adapter.ts:187–237`, `wrapToolWithEvents`).

## What worked

- **Trajectory assertions over real tools, no mocks.** `tests/unit/dogfood-mockist-workflow.test.mts` asserts an ordered multi-tool trajectory (`context_recall` → `read_ontology`) and a failure-recovery path (a stubbed tool throws; the agent proceeds; the error is recorded on the trajectory) against the real `createWorkflowTools` set, with **no** `vi.mock('@/lib/prisma', …)` and no queue mock. Because every tool is stubbed, the internal deps never run, so no DB/Redis is needed.
- **Natural fit with existing code.** mockist's `wrapVercelTools` is the same shape as Synapse's own `wrapToolWithEvents`; it slots into the `orchestrator-adapter.ts` chokepoint and composes with the existing wrapper.
- **Adapter is generate-fn agnostic.** It wraps the tool set, so it doesn't care that Synapse calls tools via `llmRouter.generateWithTools` / `meteredStreamTextSimple` rather than raw `generateText`.

## What boundary stubbing could NOT do (the gap)

- **It can't test a tool's own internals.** Stubbing a tool at the boundary replaces its entire `execute`, so it cannot exercise the tool's own prisma/queue logic. Synapse's existing unit tests (`crm-tools.test.mts`, `email-compose.test.mts`, …) that mock prisma to test `execute` internals are testing a *different* thing — mockist does **not** replace them. Boundary stubbing (trajectory) and dependency mocking (internals) are complementary, not substitutes.
- This matters because the Synapse origin-story bugs (PRIMER) lived **inside** `execute` (prisma/queue/Gmail) — exactly what boundary stubbing can't reach.

## Coverage gaps hit

- **Workflow-engine steps are out of scope.** `CONDITION`/`TRANSFORM`/`WAIT`/`CONTEXT_WRITE`/`OBSERVE`/`HUMAN_GATE` (in `lib/queue/workers/workflow-engine.ts`) call prisma/queue/notifications directly — never through a Vercel `tool()` — so there's no `execute` boundary to wrap.
- **Sub-agent boundary.** Each agent / handoff sub-agent runs its own `generateWithTools` loop with its own tool set; one harness only observes the tool set it wrapped. Watching a whole multi-agent workflow with a single trajectory needs the harness applied at each assembly point.
- **`send_email` isn't a Vercel `tool()`** — it's a custom `IntegrationSkillDef`, so the current adapter doesn't cover it.
- **Verification fidelity.** The shape check is at the tool-factory level, not a full workflow-engine run (the `AGENT_RUN` path has no injectable test model and needs BullMQ/Redis). A higher-fidelity check via the streaming orchestrator's `context.testModel` + `meteredStreamTextSimple`'s `mock-provider` bypass is the next verification rung (not done).
- **Lockfile churn.** `npm install file:../toolest` in Synapse caused sizable `package-lock.json` churn (npm re-resolving a stale lockfile). Fine for the throwaway dogfood branch; would need a clean lockfile before any real integration.

## Backlog re-order (recommendation)

1. **Keep mockist's current scope as a shipped capability** — agent-trajectory + failure-recovery testing is validated as useful. Next mechanical wins that compound it: **sequential stubs** (`[error, then ok]`) and **record → replay**.
2. **"Dependency replay inside `execute`" stays the moat, but reframe it as a separate capability**, not the next increment of the adapter. It's what catches the origin-story bugs; boundary stubbing provably can't. Prioritize it when the goal shifts from "test the agent's tool use" to "test the tool's internals deterministically."
3. **New candidate item: multi-tool-set / sub-agent harness composition** — a way to attach one harness (or merge trajectories) across the sub-agent boundary, so a whole workflow's trajectory is observable. Surfaced directly by this dogfood.
4. **Claude Agent SDK adapter** remains valuable but is orthogonal to the Synapse (Vercel SDK) findings.

See [BACKLOG.md](./BACKLOG.md).
