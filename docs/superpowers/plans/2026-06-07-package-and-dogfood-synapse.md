# Package mockist & Dogfood Against Synapse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mockist a consumable npm package, then dogfood it against the Synapse repo to decide — with evidence — whether tool-boundary stubbing is "relief or ceremony," and what the backlog priority order should be afterward.

**Architecture:** Two parts. **Part A (packaging)** adds a `tsup` build emitting ESM + `.d.ts` to `dist/`, wires `package.json` `exports`/`types`, and drops `"private"`. **Part B (verify + dogfood)** links the built package into `/Users/dhanvi/dev/synapse`, first *verifies the integration shape actually holds* — that `wrapVercelTools` interception survives to the SDK invocation on the model-driven (workflow `AGENT_RUN` / orchestrator) tool path — then builds a trajectory + failure-recovery test on real Synapse workflow tools, and records the findings + gate decision.

**Tech Stack:** TypeScript (ESM, `"type": "module"`), Vitest 4, Vercel AI SDK `ai` ^6 (`MockLanguageModelV3` from `ai/test`), Zod 4, `tsup` for the build. Synapse is Vitest 4 + `ai` ^6.0.168 + path alias `@/* → ./*`.

---

## Why this experiment, not a 1:1 test rewrite

A survey of Synapse (2026-06-07) found that its tools call dependencies (`prisma`, the BullMQ queue, the email-approval/notification helpers) **inside** each tool's `execute` — e.g. `crm-tools.ts`'s `search_contacts.execute` calls `prisma.contact.findMany()` directly; the `send_email` skill wraps `createOutboundEmail()`, which does all the prisma/queue work internally. mockist's MVP stubs only at the **tool boundary** (it routes each tool's `execute` through the harness; it cannot reach deps *inside* `execute`).

Consequences that shape this plan:
- The existing unit tests (`tests/unit/email-compose.test.mts`, `crm-tools.test.mts`, `email-approval.test.mts`) test `execute`'s **internal** logic by mocking prisma/queue. mockist's boundary stubbing **cannot** replace those — stubbing at the boundary replaces the whole tool, testing nothing about its internals. **Do not attempt a 1:1 rewrite of those.**
- What mockist *uniquely* enables is the test nobody writes today: **agent-trajectory + failure-recovery** — given a prompt and the real tool set, does the model call the right tool with valid args, and does it recover when a tool fails? That is the Part B experiment.
- `send_email` is **not** a Vercel `tool()` — it's a custom `IntegrationSkillDef`. It's out of scope for this adapter; note it as adapter-coverage backlog, don't try to wrap it.
- The boundary-vs-internal gap is itself the **gate signal**: it tells us whether backlog item "dependency replay inside `execute`" must jump ahead of sequential-stubs / record-replay / more-adapters. Capturing that (Task 8) is a deliverable, not an afterthought.

### Why workflows are the target — and what "verify the shape holds" means

The most valuable model-driven tool calls in Synapse are inside **workflow `AGENT_RUN` steps** and the conversation/streaming/handoff orchestrators: the model implicitly decides which tools to fire inside an `ai` SDK loop. That is exactly mockist's sweet spot (assert *which* tools ran, in what order, did the agent recover from a failure) — and unlike the CRM unit tests, you genuinely want trajectory assertions here, not internal-prisma assertions. The workflow engine's *own* steps (`CONDITION`/`TRANSFORM`/`WAIT`/`CONTEXT_WRITE`/`OBSERVE`/`HUMAN_GATE`) call prisma/queue/notifications **directly**, never through a Vercel `tool()`, so they're out of scope (same internal-deps gap, plus a queue seam).

A static trace (2026-06-07) confirmed the interception point survives end-to-end on the model-driven path:
- Tool sets pass **by reference** the whole way: `generateWithTools` → `meteredGenerateText` → `ai.generateText` (`router.ts:170`, `metered.ts:212`), and `meteredStreamTextSimple` → `ai.streamText` via a shallow `{...params}` spread (`metered.ts:300`). Nothing rebuilds tools, reconstructs from schema, or strips `execute`.
- Synapse **already** wraps each tool's `execute` with a shallow `{...t, execute}` (`orchestrator-adapter.ts:187–237`, `wrapToolWithEvents`) and that wrapper reaches and fires at the SDK — so execute-wrapping surviving this path is proven in-repo, and mockist's `wrapVercelTools` (same shape) composes with it.

**But a static trace is not proof of runtime behavior.** Task 5 turns the assumption into an executed check: wrap Synapse's *real* workflow tool factory output with mockist, drive it with a scripted mock model, and assert interception actually fires. This is deliberately done at the **tool-factory level**, not by booting the workflow engine — the `AGENT_RUN` path picks its model via `getProviderModel(...)` (no injectable test model) and runs over BullMQ/Redis+prisma, so a full end-to-end workflow run is out of scope; the factory-level check isolates the exact load-bearing claim ("real Synapse tools + mockist wrapping + SDK loop → interception") without that machinery. (A full-orchestrator integration check is possible via the `meteredStreamTextSimple` `mock-provider` bypass + `context.testModel` seam in the streaming orchestrator — noted as optional follow-up in Task 6.)

---

## File Structure

**Part A — in `/Users/dhanvi/dev/toolest` (the mockist repo):**
- Create: `tsup.config.ts` — build config (entry, formats, dts, clean).
- Modify: `package.json` — add `tsup` devDep, `build`/`prepublishOnly` scripts, `exports`/`main`/`module`/`types`/`files`/`sideEffects`, drop `"private"`.
- Modify: `.gitignore` — ensure `dist/` is ignored (verify; add if missing).
- Create: `docs/BACKLOG.md` — canonical backlog (the `mockist-next-work` memory points here, but the file doesn't exist yet; spec's Backlog section is the current source of truth to copy from).

**Part B — in `/Users/dhanvi/dev/synapse` (the dogfood target):**
- Modify: `package.json` — add `mockist` as a `file:` dependency (dev).
- Create: `tests/unit/mockist-shape-check.test.mts` — minimal runtime proof that interception fires on a real workflow tool (Task 5).
- Create: `tests/unit/dogfood-mockist-workflow.test.mts` — the trajectory + failure-recovery experiment on the real workflow tool set (Task 6).
- Create: `/Users/dhanvi/dev/toolest/docs/mockist-dogfood-findings.md` — the written gate decision (lives in the mockist repo; Task 8).

---

## PART A — Package mockist

> Packaging is configuration, not behavior, so it is not TDD'd (per the TDD skill's config exception). Each task is verified by **building and importing the artifact**, which is the meaningful check for a package.

### Task 1: Add the `tsup` build

**Files:**
- Create: `/Users/dhanvi/dev/toolest/tsup.config.ts`
- Modify: `/Users/dhanvi/dev/toolest/package.json`

- [ ] **Step 1: Install tsup**

Run:
```bash
cd /Users/dhanvi/dev/toolest && npm install -D tsup
```
Expected: `tsup` added to `devDependencies`, no errors.

- [ ] **Step 2: Create the tsup config**

Create `/Users/dhanvi/dev/toolest/tsup.config.ts`:
```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // ai/zod are peerDeps — never bundle them in.
  external: ["ai", "zod"],
});
```

Rationale: ESM-only matches `"type": "module"` and the SDK. `dts: true` emits `dist/index.d.ts`. `external` keeps peer deps out of the bundle. (We use `tsup`, not raw `tsc`, because the source uses extensionless relative imports under `moduleResolution: Bundler` — `tsc` would emit ESM that Node can't resolve at runtime without rewriting extensions; `tsup`/esbuild bundles to a single resolvable file.)

- [ ] **Step 3: Add build script**

In `/Users/dhanvi/dev/toolest/package.json`, add to `"scripts"`:
```json
"build": "tsup"
```

- [ ] **Step 4: Build and inspect output**

Run:
```bash
cd /Users/dhanvi/dev/toolest && npm run build && ls -la dist
```
Expected: exits 0; `dist/` contains `index.js`, `index.d.ts`, `index.js.map`.

- [ ] **Step 5: Verify the built bundle imports and the public API is intact**

Run:
```bash
cd /Users/dhanvi/dev/toolest && node --input-type=module -e "import * as m from './dist/index.js'; const want=['createHarness','Harness','defineStubs','predicateResolver','Recorder','identify','stableStringify','deepEqual','wrapVercelTools']; const missing=want.filter(k=>!(k in m)); if(missing.length){console.error('MISSING',missing);process.exit(1)}; console.log('OK exports:',Object.keys(m).sort().join(','))"
```
Expected: prints `OK exports: ...` listing all nine names; exits 0. (These nine are the runtime exports in `src/index.ts`; the type-only exports won't appear at runtime, which is correct.)

- [ ] **Step 6: Confirm dist is gitignored**

Run:
```bash
cd /Users/dhanvi/dev/toolest && git check-ignore dist && echo IGNORED || echo NOT-IGNORED
```
Expected: `IGNORED`. If it prints `NOT-IGNORED`, add a line `dist/` to `/Users/dhanvi/dev/toolest/.gitignore` and re-run until it prints `IGNORED`.

- [ ] **Step 7: Commit**

```bash
cd /Users/dhanvi/dev/toolest
git add tsup.config.ts package.json package-lock.json .gitignore
git commit -m "build: add tsup build emitting dist/ (ESM + d.ts)"
```

---

### Task 2: Make `package.json` a publishable package manifest

**Files:**
- Modify: `/Users/dhanvi/dev/toolest/package.json`

- [ ] **Step 1: Set the package entry points and drop `private`**

Edit `/Users/dhanvi/dev/toolest/package.json`. Remove the `"private": true` line. Add these top-level fields (alongside `name`/`version`/`type`):
```json
"main": "./dist/index.js",
"module": "./dist/index.js",
"types": "./dist/index.d.ts",
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  }
},
"files": ["dist"],
"sideEffects": false,
"prepublishOnly": "npm run build"
```
Keep `version` at `0.0.0` (unpublished). Leave `peerDependencies` (`ai`, `zod`) and `devDependencies` as-is.

- [ ] **Step 2: Verify the package contents are exactly `dist/`**

Run:
```bash
cd /Users/dhanvi/dev/toolest && npm pack --dry-run 2>&1
```
Expected: the file list contains only `package.json`, `dist/index.js`, `dist/index.d.ts`, `dist/index.js.map` (plus README if present). No `src/`, no `test/`. If `src/` appears, fix the `"files"` field.

- [ ] **Step 3: Confirm existing checks still pass**

Run:
```bash
cd /Users/dhanvi/dev/toolest && npm run typecheck && npm test
```
Expected: typecheck clean; all 34 tests pass. (Packaging changes must not alter behavior.)

- [ ] **Step 4: Commit**

```bash
cd /Users/dhanvi/dev/toolest
git add package.json
git commit -m "build: publishable manifest (exports/types/files, drop private)"
```

---

### Task 3: Create the canonical `docs/BACKLOG.md`

**Files:**
- Create: `/Users/dhanvi/dev/toolest/docs/BACKLOG.md`

Context: the `mockist-next-work` memory says "Full detail in repo `docs/BACKLOG.md`" but that file does not exist; the live source is the spec's Backlog section. Create the file so the pointer is valid and Part B's findings have a home to update.

- [ ] **Step 1: Write `docs/BACKLOG.md`**

Create `/Users/dhanvi/dev/toolest/docs/BACKLOG.md`:
```markdown
# mockist backlog

Source of truth for post-MVP work. Mirrors the spec's Backlog section
(`docs/superpowers/specs/2026-06-06-declarative-tool-stub-harness-design.md`).

## Priority

1. **Package + dogfood against Synapse** — make mockist consumable; rewrite/author a
   real agent test against `/Users/dhanvi/dev/synapse` to learn where tool-boundary
   stubbing helps and where it falls short. (Plan:
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
```

- [ ] **Step 2: Commit**

```bash
cd /Users/dhanvi/dev/toolest
git add docs/BACKLOG.md
git commit -m "docs: add canonical BACKLOG.md (fixes stale memory pointer)"
```

---

## PART B — Verify the shape holds, then dogfood a workflow agent step

> Part B runs in `/Users/dhanvi/dev/synapse`. It produces (a) a minimal **runtime verification** that mockist interception actually fires on a real workflow tool (Task 5 — the load-bearing check), (b) a **trajectory + failure-recovery dogfood** on the real workflow tool set (Task 6), and (c) a written gate decision (Task 8). Tasks 5–6 are TDD-appropriate (they assert behavior) and follow red→green.

### Task 4: Link mockist into Synapse

**Files:**
- Modify: `/Users/dhanvi/dev/synapse/package.json`

- [ ] **Step 1: Ensure mockist is built**

Run:
```bash
cd /Users/dhanvi/dev/toolest && npm run build && ls dist/index.js
```
Expected: `dist/index.js` exists.

- [ ] **Step 2: Add mockist as a `file:` dev dependency in Synapse**

Run:
```bash
cd /Users/dhanvi/dev/synapse && npm install -D file:../toolest
```
(`/Users/dhanvi/dev/toolest` is the mockist repo; the package name is `mockist`.)
Expected: `"mockist": "file:../toolest"` appears in `devDependencies`; install succeeds.

- [ ] **Step 3: Verify Synapse can resolve and import mockist**

Run:
```bash
cd /Users/dhanvi/dev/synapse && node --input-type=module -e "import { createHarness, wrapVercelTools } from 'mockist'; console.log(typeof createHarness, typeof wrapVercelTools)"
```
Expected: prints `function function`.

- [ ] **Step 4: Do NOT commit yet**

This dependency wiring is committed together with the tests in Task 7 (so Synapse history stays coherent). Leave the working tree dirty.

---

### Task 5: Verify the shape holds — interception fires on a real workflow tool (RED→GREEN)

**Files:**
- Create: `/Users/dhanvi/dev/synapse/tests/unit/mockist-shape-check.test.mts`

Goal: turn the static trace into an executed proof. Wrap the **real** workflow tool factory's output with `wrapVercelTools`, drive it with a scripted mock model, and assert the call lands in `harness.trajectory` with `stubbed: true` and the real `execute` never runs. This is at the factory level (no workflow engine / queue), isolating exactly: *real Synapse tools + mockist wrapping + SDK loop → interception works.*

First read the real factories so the test targets an always-present tool with the right context shape.

- [ ] **Step 1: Read the workflow/shared tool factories and pick an unconditional tool**

Run:
```bash
cd /Users/dhanvi/dev/synapse && sed -n '1120,1245p' lib/agent/tools.ts
```
Expected: locate `createSharedTools(context)` and `createWorkflowTools(context)`. Note (a) the exact context field names each requires (`SharedToolContext` / `WorkflowToolContext`), and (b) a tool key that is **unconditionally** present (not gated behind `activeIntegrations`/`activeSkillKeys`) — e.g. `context_recall`, `read_ontology`, or `ask_agent`. Use that key as `TOOL` below, and set `CTX` to satisfy the context type (string ids are fine; the tool is stubbed so `execute` won't run).

- [ ] **Step 2: Write the verification test**

Create `/Users/dhanvi/dev/synapse/tests/unit/mockist-shape-check.test.mts`:
```typescript
import { describe, expect, test, vi } from 'vitest';
import { generateText, stepCountIs } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { createHarness, wrapVercelTools } from 'mockist';
import { createWorkflowTools } from '@/lib/agent/tools';

// --- MockLanguageModelV3 V3 boilerplate (mirrors mockist test/e2e-vercel.test.ts) ---
const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};
const toolCallStep = (toolName: string, input: unknown, id: string) => ({
  content: [{ type: 'tool-call' as const, toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: 'tool-calls' as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});
const textStep = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});
type Step = ReturnType<typeof toolCallStep> | ReturnType<typeof textStep>;
function scripted(...steps: Step[]) {
  let i = 0;
  return new MockLanguageModelV3({ doGenerate: async () => steps[Math.min(i++, steps.length - 1)]! });
}

// Adjust to Step 1's findings.
const CTX = { tenantId: 'tenant-1', userId: 'user-1', agentId: 'agent-1', runId: 'run-1' } as any;
const TOOL = 'context_recall';                 // <- an unconditional key from createWorkflowTools
const TOOL_INPUT = { query: 'anything' };      // <- match that tool's inputSchema field name

describe('mockist shape check: interception survives to the SDK on the workflow tool path', () => {
  test('a stubbed real workflow tool is intercepted; trajectory records it; real execute never runs', async () => {
    const harness = createHarness({
      onUnhandled: 'error', // sealed: proves the model called ONLY the tool we stubbed
      stubs: [{ name: TOOL, match: () => true, result: { ok: true, note: 'canned' } }],
    });
    const model = scripted(toolCallStep(TOOL, TOOL_INPUT, 's1'), textStep('done: canned'));

    const realTools = createWorkflowTools(CTX);
    // Spy on the real tool's execute to prove it is NOT called when stubbed.
    const realExecute = vi.spyOn(realTools[TOOL] as any, 'execute');

    const result = await generateText({
      model,
      tools: wrapVercelTools(realTools as any, harness),
      prompt: 'call the tool',
      stopWhen: stepCountIs(5),
    });

    expect(result.text).toContain('canned');                 // canned result reached the model loop
    expect(harness.callsTo(TOOL)).toHaveLength(1);            // interception recorded the call
    expect(harness.trajectory[0]).toMatchObject({ name: TOOL, stubbed: true });
    expect(realExecute).not.toHaveBeenCalled();               // real execute (prisma/etc.) never ran
  });
});
```

- [ ] **Step 3: Run and watch it fail (RED)**

Run:
```bash
cd /Users/dhanvi/dev/synapse && npx vitest run tests/unit/mockist-shape-check.test.mts 2>&1 | tail -40
```
Expected RED while wiring is wrong (each is diagnostic, not a mockist failure):
- import/resolution error for `mockist` → revisit Task 4;
- `onUnhandled: 'error'` throws a tool name → `TOOL` isn't a real key, or the script names it wrong → fix from Step 1;
- `vi.spyOn` throws "property execute does not exist" → the chosen `TOOL` is a client-side tool with no `execute`; pick one that has `execute` (Step 1).
**If** the call is NOT intercepted (e.g. `realExecute` *was* called, or `trajectory` is empty while no error threw) — STOP. That would mean the shape does **not** hold (some layer rebuilds the tool). Capture the exact observation; it is a primary finding for Task 8 and likely blocks the workflow use case.

- [ ] **Step 4: Reconcile names, run until GREEN**

Set `TOOL`/`TOOL_INPUT`/`CTX` from Step 1. Run:
```bash
cd /Users/dhanvi/dev/synapse && npx vitest run tests/unit/mockist-shape-check.test.mts 2>&1 | tail -20
```
Expected: 1 passed. This is the executed proof that the integration shape holds on the model-driven workflow tool path.

---

### Task 6: Dogfood — trajectory + failure recovery on the real workflow tool set (RED→GREEN)

**Files:**
- Create: `/Users/dhanvi/dev/synapse/tests/unit/dogfood-mockist-workflow.test.mts`

Goal: demonstrate the value mockist uniquely provides for workflows — assert a *multi-step trajectory* and *failure recovery* over the real workflow tool set, with zero prisma/queue mocking. Reuses the boilerplate from Task 5.

- [ ] **Step 1: Pick two unconditional tools and a recovery narrative**

From Task 5 Step 1, choose two always-present tool keys from `createWorkflowTools` (e.g. `context_recall` then `read_ontology` — use whatever Step 1 confirmed). Decide a two-step happy path (call tool A, then summarize) and a failure path (tool A throws → model apologizes/falls back).

- [ ] **Step 2: Write the test**

Create `/Users/dhanvi/dev/synapse/tests/unit/dogfood-mockist-workflow.test.mts`:
```typescript
import { describe, expect, test } from 'vitest';
import { generateText, stepCountIs } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { createHarness, wrapVercelTools } from 'mockist';
import { createWorkflowTools } from '@/lib/agent/tools';

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};
const toolCallStep = (toolName: string, input: unknown, id: string) => ({
  content: [{ type: 'tool-call' as const, toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: 'tool-calls' as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});
const textStep = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});
type Step = ReturnType<typeof toolCallStep> | ReturnType<typeof textStep>;
function scripted(...steps: Step[]) {
  let i = 0;
  return new MockLanguageModelV3({ doGenerate: async () => steps[Math.min(i++, steps.length - 1)]! });
}

const CTX = { tenantId: 'tenant-1', userId: 'user-1', agentId: 'agent-1', runId: 'run-1' } as any;
const TOOL_A = 'context_recall';   // <- from Task 5 Step 1
const TOOL_B = 'read_ontology';    // <- from Task 5 Step 1
const A_INPUT = { query: 'q' };    // <- match inputSchema
const B_INPUT = {};                // <- match inputSchema

describe('dogfood: workflow agent-step trajectory over real tools (no prisma mock)', () => {
  test('happy path: agent calls A then B; trajectory records both, in order, stubbed', async () => {
    const harness = createHarness({
      onUnhandled: 'error',
      stubs: [
        { name: TOOL_A, match: () => true, result: { recalled: ['x'] } },
        { name: TOOL_B, match: () => true, result: { ontology: ['Contact'] } },
      ],
    });
    const model = scripted(
      toolCallStep(TOOL_A, A_INPUT, 'a1'),
      toolCallStep(TOOL_B, B_INPUT, 'b1'),
      textStep('Done.'),
    );

    await generateText({
      model,
      tools: wrapVercelTools(createWorkflowTools(CTX) as any, harness),
      prompt: 'do the workflow step',
      stopWhen: stepCountIs(5),
    });

    expect(harness.trajectory.map((c) => c.name)).toEqual([TOOL_A, TOOL_B]);
    expect(harness.trajectory.every((c) => c.stubbed)).toBe(true);
  });

  test('failure recovery: A throws, agent recovers, trajectory shows the failure', async () => {
    const harness = createHarness({
      stubs: [{ name: TOOL_A, result: () => { throw new Error('upstream unavailable'); } }],
    });
    const model = scripted(
      toolCallStep(TOOL_A, A_INPUT, 'a2'),
      textStep('That lookup failed; proceeding without it.'),
    );

    const result = await generateText({
      model,
      tools: wrapVercelTools(createWorkflowTools(CTX) as any, harness),
      prompt: 'do the workflow step',
      stopWhen: stepCountIs(5),
    });

    expect(result.text).toContain('failed');
    expect(harness.trajectory[0]).toMatchObject({ name: TOOL_A, stubbed: true });
    expect(harness.trajectory[0]!.error).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 3: Run RED → reconcile names → GREEN**

Run:
```bash
cd /Users/dhanvi/dev/synapse && npx vitest run tests/unit/dogfood-mockist-workflow.test.mts 2>&1 | tail -30
```
Reconcile `TOOL_A`/`TOOL_B`/inputs/CTX from Task 5 Step 1 until **2 passed**. A sealed-test (`onUnhandled: 'error'`) surprise — the model loop calling a tool you didn't script — is a *finding* for Task 8, not a bug; record it and adjust the script.

- [ ] **Step 4: Confirm zero dependency mocking**

Verify neither Part-B test file contains `vi.mock('@/lib/prisma', …)` or any queue mock, and the runs touched no DB. Headline result: workflow-step trajectory + recovery tested with zero dependency mocking.

- [ ] **Step 5 (optional follow-up — note only, do not build now):** A higher-fidelity check could drive the *actual* streaming orchestrator via its `context.testModel` seam + the `meteredStreamTextSimple` `mock-provider` billing bypass, wrapping the tool set at `streaming-orchestrator.ts`'s assembly point. Out of scope for this plan; log it in the findings (Task 8) as the next rung of verification.

---

### Task 7: Commit the Synapse-side verification + dogfood

**Files:**
- Modify: `/Users/dhanvi/dev/synapse/package.json` (from Task 4)
- Create: `/Users/dhanvi/dev/synapse/tests/unit/mockist-shape-check.test.mts`
- Create: `/Users/dhanvi/dev/synapse/tests/unit/dogfood-mockist-workflow.test.mts`

- [ ] **Step 1: Create a branch in Synapse**

Run:
```bash
cd /Users/dhanvi/dev/synapse && git checkout -b dogfood/mockist-workflow-tools
```

- [ ] **Step 2: Commit**

```bash
cd /Users/dhanvi/dev/synapse
git add package.json package-lock.json tests/unit/mockist-shape-check.test.mts tests/unit/dogfood-mockist-workflow.test.mts
git commit -m "test: verify + dogfood mockist on workflow tools (trajectory, no prisma mock)"
```
(Do not push — exploratory branch unless the user asks otherwise.)

---

### Task 8: Write the gate decision

**Files:**
- Create: `/Users/dhanvi/dev/toolest/docs/mockist-dogfood-findings.md`
- Modify: `/Users/dhanvi/dev/toolest/docs/BACKLOG.md` (Findings log section)

Convert the experiment into a decision and a re-ordered backlog. Findings live in the **mockist** repo (the product), not Synapse.

- [ ] **Step 1: Write the findings doc**

Create `/Users/dhanvi/dev/toolest/docs/mockist-dogfood-findings.md` with these sections, filled from what actually happened (no placeholders — write the real observations):
- **Shape verified?** — did Task 5 prove interception fires on the real workflow tool path (yes/no), with the one observation that proves it (trajectory recorded + real `execute` not called). If no, this is the headline and likely blocks the workflow use case.
- **What worked** — workflow-step trajectory + failure-recovery over real `createWorkflowTools`, zero prisma/queue mocking; note line counts vs an equivalent hand-mocked test.
- **What boundary stubbing could NOT do** — the internal-deps gap: stubbing a tool at the boundary replaces its whole `execute`, so it can't test the tool's own prisma/queue logic (the existing unit tests still own that). Boundary stubbing and dep-mocking test *different things*.
- **Coverage gaps hit** — the engine's own steps (`CONDITION`/`TRANSFORM`/`WAIT`/`CONTEXT_WRITE`/`OBSERVE`/`HUMAN_GATE`) and the sub-agent boundary (one harness sees only the tool set it wrapped); `send_email` is a custom `IntegrationSkillDef`, not a Vercel `tool()`.
- **Relief or ceremony?** — the explicit kill/continue call from OUTLINE.md's gate, one-line reason.
- **Backlog re-order** — concrete recommendation: does "dependency replay inside `execute`" move ahead of sequential-stubs / record-replay / adapters? Should a sub-agent/whole-workflow harness composition land as a new item? Justify from the evidence.

- [ ] **Step 2: Link the findings from BACKLOG.md**

In `/Users/dhanvi/dev/toolest/docs/BACKLOG.md`, replace the `Findings log` placeholder line with a one-line pointer to `mockist-dogfood-findings.md` and the headline verdict (shape-holds + relief/ceremony + the single biggest reprioritization).

- [ ] **Step 3: Commit (in mockist repo, on `feat/tool-stub-harness`)**

```bash
cd /Users/dhanvi/dev/toolest
git add docs/mockist-dogfood-findings.md docs/BACKLOG.md
git commit -m "docs: Synapse workflow dogfood findings + gate decision"
```

- [ ] **Step 4: Update project memory**

Update the `mockist-next-work` memory file (`/Users/dhanvi/.claude/projects/-Users-dhanvi-dev-toolest/memory/mockist-next-work.md`) to reflect the post-dogfood priority order, that packaging is done, and that the workflow interception shape was verified. Keep it terse.

---

## Self-Review

**Spec/goal coverage:**
- "Make mockist consumable (dist/, exports, drop private)" → Tasks 1–2. ✔
- "Verify the current shape/setup holds in Synapse for the model-driven (workflow) tool path" → Task 5 (executed runtime proof at the factory level). ✔
- "Dogfood against Synapse" → reframed (with evidence) to *author* the trajectory + failure-recovery test mockist uniquely enables, on real workflow tools, because Synapse's deps are inside `execute` → Task 6. ✔
- "Answer: relief or ceremony, where does it fall short, reprioritize" → Task 8 (gate decision + backlog re-order). ✔
- Stale `docs/BACKLOG.md` memory pointer → Task 3 creates it. ✔

**Placeholder scan:** Build config, package fields, and all three test bodies are given in full. Intentionally-deferred content: the *observed findings* in Task 8 (unknowable before the run) and the `TOOL`/`CTX`/input reconciliation in Tasks 5–6 (must match the real `tools.ts`, which Task 5 Step 1 reads first). These are flagged "fill from what you observe," not vague hand-waving.

**Type/name consistency:** `createHarness`, `wrapVercelTools`, `harness.trajectory`, `harness.callsTo`, `onUnhandled` match `src/index.ts` and `src/core/harness.ts`. `MockLanguageModelV3` import + V3 step shapes copied verbatim from the passing `test/e2e-vercel.test.ts`. Package export names in Task 1 Step 5 match `src/index.ts`'s runtime exports exactly (nine). `createWorkflowTools` is the real Synapse factory confirmed in the exploration (`lib/agent/tools.ts:1233`).

**Risks called out in-plan:** `tsc`-vs-`tsup` extension footgun (Task 1 Step 2); the AGENT_RUN path has no injectable test model + needs the queue, so verification is done at the factory level not end-to-end (Why section + Task 5 goal); chosen tool must have an `execute` and be unconditional (Task 5 Steps 1, 3); the sub-agent boundary limits one harness to one tool set (Why section + Task 8); a non-interception result in Task 5 is a STOP-and-report finding, not something to paper over (Task 5 Step 3).
