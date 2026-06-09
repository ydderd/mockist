# mockist backlog

Source of truth for post-MVP work. Mirrors the spec's Backlog section
(`docs/superpowers/specs/2026-06-06-declarative-tool-stub-harness-design.md`).

## Priority

1. **Package + dogfood against Synapse** — make mockist consumable; verify the
   interception shape holds on Synapse's model-driven (workflow `AGENT_RUN`) tool
   path, then author a real agent test against `/Users/dhanvi/dev/synapse` to learn
   where tool-boundary stubbing helps and where it falls short. (Plan:
   `docs/superpowers/plans/2026-06-07-package-and-dogfood-synapse.md`.)
   **The dogfood result re-orders everything below it.**

## Then, in rough order

- **Sequential stubs** — `[error, then ok]` so a clean retry-to-success can be tested.
- **Record → replay** — capture real runs, emit hand-editable stubs / cassettes (uses the extension seams).
- **Claude Agent SDK adapter** — tools + skills + sub-agents via PreToolUse deny + PostToolUse `updatedToolOutput`.
- **Dependency replay inside `execute`** — mock the DB/HTTP/queue a tool performs internally.
  (Synapse's origin-story bugs lived here — Part B will likely raise this item's priority.)
- **More adapters** — MCP, OpenAI.
- **Schema-grounded stubs** — validate a stub's output against the tool's JSON Schema; generate a starter stub from it.
- **Optional runner matchers** — e.g. `toHaveCalledTool`, once we know which runner users want.

## Findings log

- _(Part B appends the Synapse dogfood findings + gate decision here — see Task 8.)_
