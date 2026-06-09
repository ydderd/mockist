# mockist — Build Outline

Companion to [PRIMER.md](./PRIMER.md). This is the *how*: architecture, the weekend de-risk, and the staged roadmap. Treat the weekend spike as a kill/continue gate before anything else.

---

## Core model (one page)

Three concepts, nothing more:

- **Tool** — ingested, never authored. From a Vercel AI SDK `tool()`, an MCP `tools/list` entry, or an OpenAI/Anthropic tool def. Gives us `name`, `description`, input/output JSON-Schema.
- **Recording** — one captured invocation: `{ tool, args, modelChoice?, dependencyCalls: [{key, request, response|error}], result|error, ts, meta(model, repo, sha) }`. JSONL on disk; uploadable later.
- **Scenario** — a named test derived from one or more recordings: `given` (the dependency responses to inject) → `when` (called-with-args, or agent-given-prompt) → `then` (assert output / tool-call trajectory / observed side-effect calls). Generated from recordings; hand-editable.

The loop: **record → promote to scenario → replay → assert/diff.**

The hard primitive: a **dependency seam** — a keyed, interceptable boundary for the I/O a tool performs (DB, HTTP, other tools/MCP). Recording captures `(key, request) → response`; replay injects the recorded response for the same key instead of hitting the real dependency.

---

## Architecture

```
            ┌─────────────────────────────────────────────┐
  your code │  const tools = wrapTools(myTools, { recorder })   ← 1-line opt-in
            └───────────────┬─────────────────────────────┘
                            │ every execute() call
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

- **Adapters** normalize each SDK's tool list into the internal `Tool` shape. Start with Vercel AI SDK + MCP.
- **Interceptor** wraps `execute()` and the tool's dependency clients. In `record` it passes through to real deps and logs; in `replay` it serves recorded responses and fails loudly on an unrecorded dependency call.
- **Dependency seam** — v1: explicit. The dev wraps their clients (`recordHttp(fetch)`, a Prisma middleware/`$extends`, an MCP client wrapper). v2: provide drop-in wrappers for the common ones (fetch/undici, Prisma, the MCP client) so it's closer to zero-config.
- **Runner** loads scenarios, drives replay, asserts, and prints a diff. Ships a CLI (`mockist run`) and test matchers.

---

## Weekend de-risk spike (the gate)

Goal: prove "replay beats hand-mocks" on real skills. Scope ruthlessly — Vercel AI SDK + HTTP-only deps, tier 1 only.

- [ ] `wrapTools(tools, { mode, dir })` for the Vercel AI SDK — wrap each `execute`.
- [ ] Dependency seam for **HTTP only**: a `recordedFetch` wrapper that logs `(method+url+bodyHash) → response` and, in replay, returns the recorded response (throws on a miss).
- [ ] Recorder: append `{tool, args, dependencyCalls, result, error}` to `fixtures/<tool>/<hash>.json`.
- [ ] `replay(tool, fixture)`: inject recorded HTTP responses, run `execute(args)`, return result + the list of dependency calls attempted.
- [ ] A vitest matcher: `await expect(replayTool('send_email', fx)).toMatchRecording()` (asserts result + that no unrecorded dependency was hit).
- [ ] **Dogfood:** point it at the Synapse email skills (`lib/integrations/gmail/skills.ts`, `lib/email/compose.ts`). Capture a real `send_email` run; replay it; intentionally break the code and confirm the replay catches what the hand-mock missed (e.g. the double-send-after-post-send-failure case).

**Kill/continue:** if replacing the hand-mocks feels like *relief*, continue. If it feels like *ceremony*, stop — write up why and shelve.

---

## Staged roadmap (only if the spike passes)

**M1 — Tier-1 library, real deps (2–3 wks)**
- Prisma dependency seam (`$extends`/middleware) + generic fetch/undici seam.
- MCP adapter (ingest `tools/list`; record/replay MCP `tools/call`).
- Fixture management: redact secrets on capture; stable hashing; `mockist record` / `mockist run` CLI.
- Test-runner integrations (vitest + jest matchers).

**M2 — Reproducible in CI (PLG rung 3)**
- GitHub Action: run the fixture suite on PRs; comment a diff; gate on regressions.
- Cross-model replay: re-run tier-1 scenarios with the model swapped (for tier-2 prep).

**M3 — Tier 2: agent trajectory (the crowded-but-valuable lane)**
- `given prompt + tool(s)` → run a (cheap) model → assert the tool-call trajectory (was it called? valid args? recovered from an injected dependency error?).
- LLM-judge for fuzzy assertions; keep deterministic dependency replay underneath so only the model varies.

**M4 — Hosted (PLG rungs 3–4, the platform)**
- Upload fixtures/runs; audit trail; team dashboards; cross-model/version diffing as a service; suite gating.

---

## Decisions to make early
- **Language/dist:** TS-first (matches the SDKs); ship as an npm package + CLI. Python adapter later if pulled.
- **Dependency seam ergonomics:** how close to truly one-line can the common wrappers get? This determines adoption (see PRIMER risk #4).
- **Secret redaction on capture:** non-negotiable before any upload tier; design it into the recorder from M1.
- **Scope discipline:** tier 1 + dependency replay is the differentiator. Resist drifting into "another eval dashboard" (tier 2 first) — that's the crowded lane.

---

## What NOT to build
- A capability-spec DSL (the tool def is the spec — ingest it).
- A generic prompt/eval playground (overlaps incumbents).
- MCP-only scope (it's one adapter, not the product).
