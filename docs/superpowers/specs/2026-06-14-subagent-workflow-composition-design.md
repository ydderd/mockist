# Sub-agent / whole-workflow harness composition — design

Status: **v1 shipped** (2026-06-19). Roadmap: M2 item 3 (done). Deferred v1.1 items
listed under [Out of scope (v1)](#out-of-scope-v1).
Authority: [`docs/BACKLOG.md`](../../BACKLOG.md).

## Goal

Observe and assert on the **full tool/skill trajectory** of a multi-agent workflow —
parent loops, sub-agent loops, and handoffs — while staying at the agentic boundary.

## Problem

Each agent / handoff runs its own SDK tool loop. One `Harness` only records calls
for the tool set it wrapped. Without composition, tests see a fragment of the workflow.

## Principles

- **Stay at the boundary.** No dependency replay inside `execute`.
- **Additive.** Reuse existing `Call`, trajectory assertions, and `wrapVercelTools`.
- **Two patterns, not one API.** Shared harness when you control assembly; explicit
  merge when loops are already separate.

## API (v1)

### Shared harness (Pattern A)

No new API. Pass one `createHarness()` instance to every `wrapVercelTools` in the
workflow. Use `mergeStubs(child, parent)` for per-agent stub layers.

### Trajectory merge (Pattern B)

```ts
concatTrajectories(...segments: readonly Call[][]): Call[]
mergeHarnessTrajectories(...harnesses: Harness[]): Call[]
```

Segments concatenate in **explicit order** (not sorted by `ts`). Use when handoffs
run as separate loops with separate harnesses.

### Handoff markers

```ts
harness.recordCall(kind, name, input, outcome?)
```

Appends to the trajectory without the resolver pipeline. Use `kind: "subagent"` to
mark a delegate / handoff boundary between merged segments.

## Canonical setup

| Shape | Setup |
|-------|--------|
| Nested sub-agent (child loop inside parent tool) | Pattern A — one harness, thread through child tool factory |
| Sequential handoff (parent loop, then child loop) | Pattern A if you control assembly; Pattern B with `mergeHarnessTrajectories` otherwise |
| Both in one test | Pattern A when possible; Pattern B + `recordCall("subagent", …)` between segments |

## Out of scope (v1)

- `harness.fork()` with shared recorder and isolated stub cursors (defer — cassette
  consume-once sharing is non-trivial; `mergeStubs` on one harness covers most cases).
- Adapters that dispatch `kind: "skill"` / `"subagent"` automatically (Claude Agent SDK
  adapter is a separate backlog item).
- Timestamp-based merge for parallel sub-agents.

## Testing

Covered in `test/composition.test.ts`:

- `concatTrajectories` ordering and empty input
- `mergeHarnessTrajectories` across two harnesses
- `recordCall` subagent boundary shape

## Implementation (v1)

| API | Location |
|-----|----------|
| `concatTrajectories`, `mergeHarnessTrajectories` | `src/core/composition.ts`, exported from `src/index.ts` |
| `harness.recordCall` | `src/core/harness.ts` |
| Pattern A (shared harness) | No new code — pass one `Harness` to each `wrapVercelTools` |
| Docs & examples | `README.md` — "Multi-agent workflows (sub-agents & handoffs)" |
