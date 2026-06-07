# mockist — Backlog

Next work after the MVP (PR #1). Branch off **`feat/tool-stub-harness`** — it has the implementation; `main` is docs-only until the PR merges.

## 1. Build, package, and dogfood against Synapse (highest priority — validation)

The MVP isn't consumable as a package yet, and we haven't proven it solves a real problem. Do both together:

- **Package it:** add a build that emits `dist/` (tsup or `tsc`), set `main` / `module` / `types` / `exports` in `package.json`, drop `"private": true`, and verify the public API imports from the built package (not `src/`).
- **Dogfood loop with Synapse** (`/Users/dhanvi/dev/synapse`): consume mockist there via `file:../mockist` (or `npm link`), and rewrite a real agent tool/skill test to use mockist instead of hand-mocks. The question to answer: does stubbing at the tool boundary beat the hand-mocks, and where does it fall short? Synapse's origin-story bugs (see `PRIMER.md`) lived in deps *inside* the tools (prisma / job queue / gmail client), so this loop should reveal how badly dependency-replay-inside-`execute` is needed — and reprioritize the items below.
- **Note:** working dir is `/Users/dhanvi/dev/toolest`; rename it to `mockist` (or reference by its actual path) so `../mockist` resolves from Synapse.

## 2. Sequential / once stubs

`[error, then ok]` so a clean retry-to-success is testable. Today's workaround is a stateful result function.

## 3. Record → replay (VCR/cassette)

Capture real runs and generate hand-editable stubs. Additive via the existing extension seams (`identify` / `Call` record / resolver pipeline / redaction hook).

## 4. More adapters

- **Claude Agent SDK** — tools, skills, AND sub-agents all flow through the `tool_name` path (PreToolUse `deny` + PostToolUse `updatedToolOutput`).
- **MCP**, **OpenAI**.

## 5. Dependency-replay inside `execute`

The original PRIMER moat — mock the DB/HTTP a tool performs internally. Prioritize based on what the Synapse dogfood reveals.

## 6. Schema-grounded stubs

Validate a stub's output against the tool's JSON Schema; generate a starter stub from it. (Idea borrowed from `mock-mcp`.)

## 7. Optional runner matchers

`toHaveCalledTool` / `toMatchTrajectory`, once we know which runner users want.
