# mockist backlog

Source of truth for post-MVP work. Mirrors the spec's Backlog section
(`docs/superpowers/specs/2026-06-06-declarative-tool-stub-harness-design.md`).
Gate decision from the Synapse dogfood: `docs/mockist-dogfood-findings.md`.

## Done

1. **Package + dogfood against Synapse** (2026-06-08) — mockist is a consumable package
   (tsup build, `dist/` + `exports`, `"private"` dropped). Verified at runtime that
   `wrapVercelTools` interception holds on Synapse's model-driven workflow `AGENT_RUN`
   tool path, and tested an agent trajectory + failure recovery with zero dependency
   mocking. Verdict: **CONTINUE (relief)**. Plan:
   `docs/superpowers/plans/2026-06-07-package-and-dogfood-synapse.md`.

   Key finding: boundary stubbing tests the *agent's tool use*, not a tool's internals —
   it complements (doesn't replace) dependency-mocked unit tests, and can't reach the
   origin-story bugs that live inside `execute`. This re-orders the items below.

2. **Sequential / once stubs** (2026-06-09) — stubs can now define ordered
   `sequence` steps with `{ result }` or `{ error }` entries for retry, polling,
   pagination, and failure-then-success flows. Exhaustion defaults to a stubbed
   error, with opt-in `"repeat-last"` and `"passthrough"` modes.

## Then, in rough order (post-dogfood)

1. **Trajectory assertion helpers + readable diffs** — keep the core runner-agnostic,
   but add assertion functions that can power Vitest/Jest matchers later. Target common
   expectations: exact trajectory, ordered subsequence, called tool, called with partial
   input, no unhandled calls, no passthrough calls. Failure messages should show expected
   vs actual calls with name, input, output/error, and `stubbed` status. This is the next
   developer-experience unlock: today users manually inspect `harness.trajectory`.

2. **Record → replay (VCR/cassette)** — capture real tool-boundary runs and generate
   hand-editable stubs. Additive via the existing extension seams (`identify` / `Call`
   record / resolver pipeline / redaction hook). Include deterministic JSON fixtures,
   redaction before disk write, fixture loading as stubs, update/approve workflow, and
   clear missing/extra call diffs.

3. **Dependency replay v1: fetch/HTTP inside `execute`** — begin the moat. Boundary
   stubbing tests whether the agent called the right tool; dependency replay tests
   whether the tool implementation behaves correctly. Start with an explicit
   `mockistFetch(fetch, harness)` seam that records method, URL, body hash/body,
   status, headers, and response body, then replays without network and fails on
   unrecorded HTTP calls in replay mode. Dependency calls should attach to the parent
   tool call.

4. **Sub-agent / whole-workflow harness composition** *(new, from the dogfood)* — one
   harness only observes the tool set it wrapped, and each sub-agent / handoff runs its
   own loop. Provide a way to attach one harness across the sub-agent boundary, or merge
   trajectories from multiple harnesses, so a whole workflow's trajectory is observable.

5. **Schema-grounded stubs and fixtures** — validate stub output against the tool's JSON
   Schema where available; optionally generate starter stubs from schema. Useful for
   preventing fake fixtures from drifting away from real tool contracts. Do not sell this
   as the main value prop; SDKs already do a lot of input validation.

6. **More adapters** — Claude Agent SDK (tools, skills, AND sub-agents all flow through
   the `tool_name` path: PreToolUse `deny` + PostToolUse `updatedToolOutput`); MCP;
   OpenAI. Keep adapters thin: normalize tool definitions and route calls into the same
   harness/recorder model.

7. **Dependency replay v2: Prisma / DB / queue / MCP clients** — after HTTP proves the
   replay model, add explicit seams for common stateful dependencies. This is the
   capability that can catch origin-story bugs inside `execute`: retries, non-atomic
   claims, duplicate side effects, cross-tenant lookups, and post-side-effect failures.

8. **Runner integrations** — optional Vitest/Jest matchers such as `toHaveCalledTool`,
   `toHaveToolTrajectory`, and `toHaveNoUnhandledToolCalls`, backed by the runner-agnostic
   assertion core. Keep this later than assertion helpers so the library does not become
   test-runner-shaped too early.

9. **Terminology and docs cleanup** — be precise about what each test proves. Scripted
   model output can prove error injection and continuation through the SDK loop; it does
   not prove that a real model would choose to recover. Prefer names like "records stubbed
   tool errors" over "failure recovery" unless the model is genuinely deciding.

## Findings log

- **2026-06-08 Synapse dogfood** → [mockist-dogfood-findings.md](./mockist-dogfood-findings.md).
  Verdict: **CONTINUE (relief)** — interception shape verified at runtime on the workflow
  tool path; trajectory + failure-recovery tested with zero dependency mocking. Biggest
  reprioritization: "dependency replay inside `execute`" is a *separate* capability (the
  moat for origin-story bugs), not the next adapter increment; new candidate item —
  sub-agent/whole-workflow harness composition.
