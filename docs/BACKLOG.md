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

## Then, in rough order (post-dogfood)

- **Sequential / once stubs** — `[error, then ok]` so a clean retry-to-success is
  testable. Today's workaround is a stateful result function.
- **Record → replay (VCR/cassette)** — capture real runs and generate hand-editable
  stubs. Additive via the existing extension seams (`identify` / `Call` record /
  resolver pipeline / redaction hook).
- **Sub-agent / whole-workflow harness composition** *(new, from the dogfood)* — one
  harness only observes the tool set it wrapped, and each sub-agent / handoff runs its
  own loop. Provide a way to attach one harness across the sub-agent boundary (or merge
  trajectories) so a whole workflow's trajectory is observable.
- **Dependency-replay inside `execute`** *(the moat)* — mock the DB/HTTP/queue a tool
  performs internally. This is a *separate capability* from boundary stubbing; it's what
  catches the origin-story bugs (see `PRIMER.md`). Prioritize when the goal shifts from
  "test the agent's tool use" to "test the tool's internals deterministically."
- **More adapters** — Claude Agent SDK (tools, skills, AND sub-agents all flow through
  the `tool_name` path: PreToolUse `deny` + PostToolUse `updatedToolOutput`); MCP; OpenAI.
- **Schema-grounded stubs** — validate a stub's output against the tool's JSON Schema;
  generate a starter stub from it. (Idea borrowed from `mock-mcp`.)
- **Optional runner matchers** — `toHaveCalledTool` / `toMatchTrajectory`, once we know
  which runner users want.

## Findings log

- **2026-06-08 Synapse dogfood** → [mockist-dogfood-findings.md](./mockist-dogfood-findings.md).
  Verdict: **CONTINUE (relief)** — interception shape verified at runtime on the workflow
  tool path; trajectory + failure-recovery tested with zero dependency mocking. Biggest
  reprioritization: "dependency replay inside `execute`" is a *separate* capability (the
  moat for origin-story bugs), not the next adapter increment; new candidate item —
  sub-agent/whole-workflow harness composition.
