# mockist — Primer

> A test harness for agent **tools and skills**: capture real tool calls, replay them deterministically (dependencies and all), and assert on them — derived from the tool definitions you already wrote, with near-zero added effort.

**Status:** idea / pre-MVP. This doc is the why + framing. Build plan is in [OUTLINE.md](./OUTLINE.md).

---

## The problem

When you build an agent, you hand an SDK a list of tools and let a model call them. You do **not** reliably see, track, or regression-test those tool calls. Today's options are bad:

- **Hand-written unit tests** mock the tool's dependencies (DB, HTTP, other tools) by hand. They're brittle, they drift, and — the killer — **they pass while the real behavior is wrong**, because the mock encodes your assumption, not reality.
- **Eval/trace platforms** (LangSmith, Langfuse, Braintrust, Arize, Promptfoo) trace runs and score model output, but they don't give you a *deterministic, dependency-mocked replay* of a specific tool/skill that you can run as a fast unit/CI test.
- **MCP test fakes** (e.g. `mock-mcp`) fake a *server* so you can test a *client*. Useful, but it's one tile, and it's still hand-authored.

Net: the tool/skill — the part that actually touches your systems and the part the model gets wrong — is the least-tested unit in the stack.

### Field evidence (the origin story)

This idea came out of shipping a tenant email-sending + CRM feature (Synapse PR #204). Every skill/tool test hand-mocked `prisma`, the job queue, and the Gmail client. The unit suite was green — yet a code-review bot found **five rounds** of real bugs the mocks structurally could not see: broken BullMQ retries, non-atomic claims causing double-sends, an orphaned in-flight status, cross-tenant mailbox mis-attribution, and a post-send failure that resent already-delivered mail. Every one was a **dependency/runtime-contract** behavior. A harness that replayed real dependency responses against a "dispatch under retry" scenario would have caught most of them.

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
behavior := from recorded real runs (args, model choice, dependency I/O, result)
tests    := promoted from those recordings, not hand-written
```

The loop is **record → replay → assert**. Zero spec language, zero maintenance tax.

---

## What it is / what it isn't

**Is:** "VCR + Pact, for agent tool calls." Instrument once, see every tool call, freeze any real one into a deterministic replayable test that stubs the tool's dependencies.

**Isn't:** a new spec format; another generic LLM-eval/trace dashboard; an MCP-only thing.

### Three test tiers (you opt into depth)
1. **Tool-as-code** — given args, does `execute()` do the right thing + the right side effects? (replay with mocked deps)
2. **Tool-under-agent** — given a prompt + this tool, does the *model* call it, with valid args, and recover from errors? (trajectory assertion; the part nobody tests)
3. **MCP-as-contract** — does the server expose the tools/schemas it claims and behave per recorded scenarios?

The **differentiated, hard, valuable** core is tier 1's **dependency replay** — recording and deterministically re-injecting the DB/HTTP/other-MCP I/O a tool performs. The eval vendors don't do this; it's exactly what hand-mocks get wrong.

---

## Wedge & distribution (PLG ladder)

The free, solo-dev rung must stand alone and be *relief, not ceremony*:

1. **`wrapTools()` skill / SDK wrapper** (free, local) — one line; now you can *see* every tool call your agent made.
2. **Record → fixtures** — freeze any real call (args + dependency responses + outcome) to a file.
3. **`replay` in tests / CI / a GitHub Action** — deterministic re-run + diff; reproducible.
4. **Hosted run-suites** — audit trails, cross-model diffing (run the same suite on Sonnet 4.6 vs 4.8 vs GPT), team gates, dashboards.

Each rung adds reproducibility/auditability; rungs 3–4 are where a platform/PLG business lives. Rung 1 is the adoption hook and must be genuinely useful with no account.

---

## Honest risks (decide before investing)

1. **The deterministic half is low-value** — SDKs already validate args against the schema; MCP is typed. Don't sell schema-checking.
2. **The non-deterministic half is crowded** — tier 2 overlaps LangSmith/Braintrust/Langfuse/Promptfoo/Arize. If that's the whole pitch, you're a feature on their roadmap.
3. **Dependency replay is the moat and the hard part** — capturing/replaying arbitrary DB/HTTP/MCP I/O deterministically is real engineering.
4. **Friction is binary** — if instrumentation isn't truly one line per SDK, it's dead.
5. **User ≠ buyer** — solo dev adopts free; the team needing CI gates/audit pays. The free tier must be painfully useful first.

---

## Verdict

There's probably something — but the sharp version is **"zero-spec VCR + contract tests for agent tool calls, derived from your SDK tools and real runs, anchored on dependency replay."** Not a spec DSL, not another eval dashboard.

**Cheapest honest test of the thesis (one weekend):** build the Vercel-AI-SDK `wrapTools()` recorder + `replay()` (inject recorded dependency responses, re-run the tool, diff), point it at a real repo's skills (the Synapse email skills are a ready-made fixture set), and see if it *obviously* beats hand-mocks. If it feels like relief, build on. If it feels like ceremony, kill it.

---

## Open references to ground before building
- Compare the convergent tool shape against real agent frameworks (Hermes/Nous function-calling format, MCP `tools/list`, OpenAI/Anthropic tool schemas) — confirm the ingest layer covers them.
- Survey what LangSmith / Braintrust / Langfuse / Promptfoo / Arize already capture, to sharpen the "dependency replay is the gap" claim.
- `mock-mcp` (github.com/mcpland/mock-mcp) for the MCP-server-fake tile.
