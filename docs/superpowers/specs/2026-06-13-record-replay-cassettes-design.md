# Record → replay (cassettes) — design

Status: approved design, pre-implementation. Roadmap: M1 rung 2 (devex-first), the last
ergonomics rung before the dependency-replay moat (Gate 2 / M2). Authority for ordering:
[`docs/BACKLOG.md`](../../BACKLOG.md). Usage/API today: [`README.md`](../../../README.md).
Prior design: `docs/superpowers/specs/2026-06-06-declarative-tool-stub-harness-design.md`.

## Goal

Capture real tool-boundary runs once and replay them as hand-editable stubs, so authoring
agent-trajectory tests is recording a scenario instead of hand-writing stub trees. Boundary
level only: a cassette records each tool call's `input` and its `output`/`error`. It does
**not** capture dependency calls inside `execute` — that is the separate moat (M2), out of
scope here.

## Principles

- **Additive on existing seams.** A cassette is two thin additions to machinery that already
  exists — it is not a new subsystem.
  - **Replay** = a resolver built from the fixture file, layered in the existing resolver
    pipeline *ahead of* the `onUnhandled` policy.
  - **Record** = a redact-and-serialize step over the `Recorder`'s trajectory.
- **The cassette is an overlay, not a seal.** A matched call is served from the cassette; an
  unmatched call falls through to the existing `onUnhandled` policy. Sealing is opt-in via
  `onUnhandled: "error"` — no new seal flag.
- **Identical test code in record and replay.** The only difference is the `MOCKIST_RECORD`
  env var; the test never branches.
- **Hand-editable, self-describing fixtures.** Deterministic JSON, readable diffs, inline
  sentinels and match directives so a fixture stays correct after manual edits.

## API shape

`cassette` is a first-class `HarnessOptions` field:

```ts
const harness = createHarness({
  cassette: "fixtures/weather-flow.json",
  onUnhandled: "error",  // seal; omit for passthrough overlay (default)
});
```

Replay is *implemented* internally as a resolver (reusing the pipeline), but `cassette` is a
harness option rather than a standalone exported resolver because **recording needs harness
lifecycle cooperation** (capture the trajectory, write on flush) that a pure resolver cannot
own.

**Resolver precedence.** The pipeline becomes `[stubResolver, cassetteResolver, ...opts.resolvers]`,
then `onUnhandled`. So hand-authored `stubs` win over the cassette (a test can deliberately
override one recorded call), the cassette wins over custom `resolvers`, and anything unmatched
falls through to the policy — consistent with first-match-wins and "narrowest/most-explicit
first." A harness with no `cassette` is unchanged.

**One harness per cassette**, hence typically one per test/scenario — the same grain as the
existing per-test harness guidance. Two tests may point at the same file; matching is
per-call, not per-test. No shared mutable state between tests keeps `reset()` and isolation
clean.

## Fixture format

One JSON file per cassette: a small header plus an **ordered** `calls` array. Array order *is*
call order, so it can also seed an `expectExactTrajectory` baseline.

```jsonc
{
  "mockist_format_version": 1,           // forward-compat; unknown version → hard error
  "recordedAt": "2026-06-13T18:04:00Z",  // informational only
  "redactions": [                        // manifest: every scrubbed path, listed once
    "calls[0].input.headers.authorization",
    "calls[2].output.providerToken"
  ],
  "calls": [
    {
      // kind defaults to "tool" — omitted unless "skill" / "subagent"
      "name": "search",
      "input": { "q": "billing" },
      "output": { "hits": ["doc-1"] }          // success → returned as-is
    },
    {
      "name": "search",
      "input": { "q": "billing", "requestId": "[REDACTED:requestId]" },
      "error": { "name": "Error", "message": "upstream timeout" },  // failure → reconstructed + thrown
      "match": { "ignore": ["input.requestId"] }
    },
    {
      "name": "now",
      "output": "2026-06-13T00:00:00Z",
      "match": "name"                          // name-only: any input matches; output still returned
    }
  ]
}
```

### Entry rules

- **`output` vs `error`** — exactly one per entry (mirrors the `sequence` step shape
  `{ result } | { error }`). On replay, `output` is returned; `error` is reconstructed as
  `new Error(message)` with `.name` restored, then thrown. Both-or-neither → validation error
  at load.
- **`match` directive** (optional; default = name + deep-equal `input`):
  - `"name"` → name only, input ignored entirely.
  - `{ "ignore": ["input.requestId", "input.headers.x"] }` → name + input minus those dotted
    paths. Array indices supported (`input.items[0].id`). A path not present in the input is a
    silent no-op.
- **Redaction sentinel** — a scrubbed value becomes the string `"[REDACTED:<field>]"`. The
  matcher recognizes this pattern and treats its path as a **wildcard automatically** (on top
  of any explicit `ignore`), so redacted inputs still match without the redactor at replay.
  Greppable and obviously-not-data; `:field` documents what it was. A real recorded string that
  happens to equal the sentinel is treated as a wildcard — acceptable given the distinctive
  format.
- **No stored match key** — identity is computed structurally at load time from
  `name` + `input` + `match`, so hand-edits take effect immediately and nothing drifts.
- **`recordedAt` and `redactions` are informational.** The inline sentinels are the source of
  truth for wildcard matching, so a hand-edited fixture stays correct even if the manifest is
  stale.

## Record flow

Triggered when `MOCKIST_RECORD` is set (directly via `MOCKIST_RECORD=1 vitest …`, or by the
`mockist record` wrapper that sets it and shells out to the configured test command). In that
mode the same `createHarness({ cassette })` call behaves differently:

1. **Do not load the cassette as stubs** — it is being (re)created. The file is overwritten
   wholesale; re-record = fresh capture, no merge.
2. **Force `onUnhandled: "passthrough"`** so real tools run and real outputs are captured. This
   overrides a configured `"error"` seal (recording a not-yet-existing cassette must not throw);
   one-time warn. Record with *no* hand-authored `stubs` to capture reality — any explicit stub
   still serves and would be baked in.
3. **Capture** — the `Recorder` already logs every call in order with
   `name`/`kind`/`input`/`output`-or-`error`. Nothing new on the hot path.
4. **Redact, then write on flush** — the default redactor walks each call and replaces
   secret-keyed values with the `[REDACTED:<field>]` sentinel; the `redactions` manifest is
   built by **scanning the redacted calls for sentinel paths** (the redactor need not report
   paths). Serialized with **sorted keys + 2-space indent** for clean diffs; parent dirs
   created. Record mode simply overwrites — no write-if-changed comparison (deliberate
   infrequent action; not worth the diffing logic).

### Saving without per-test calls

Writes must not litter tests, and must never touch files in replay. Mechanism:

- In record mode, `createHarness({ cassette })` auto-registers itself in a module-level pending
  list.
- mockist ships a tiny runner setup module (`mockist/vitest-setup`, `mockist/jest-setup`) that
  wires an `afterEach`/`afterAll` to flush that list — write each harness's cassette, then
  clear. Added once via the runner's `setupFiles`.
- The `mockist record` wrapper is then just glue: it sets `MOCKIST_RECORD=1` and runs the
  normal test command; the registered hook does the saving.

| Mode | Writes? |
|---|---|
| Replay (default / CI) | Never. Zero churn. |
| Record (`MOCKIST_RECORD` set) | Overwrites each cassette, via the once-registered setup hook |

### Default redactor

Deep-walks a call and replaces values whose **key** matches a known secret-bearing name
(`authorization`, `api_key`, `apikey`, `token`, `password`, `secret`, `cookie`, `set-cookie`)
with `"[REDACTED:<key>]"`. Users replace or extend it via the existing `redact: (call) => call`
hook; opting out is explicit. Redaction is applied to both input and output; because redacted
input paths become wildcards at match time, scrubbing an input field does not break matching.

## Replay flow

In replay mode (no `MOCKIST_RECORD`), `createHarness({ cassette })` loads and parses the
fixture once and builds a resolver from its `calls`, layered ahead of `onUnhandled`.

- **Missing file** → not a throw. Empty overlay: every call falls through to `onUnhandled`,
  with a one-time `console.warn`. With `"error"` this surfaces as a clear seal failure on the
  first call; with passthrough everything hits real tools.
- **Malformed JSON / unknown version / invalid entry** → hard throw at load (the file exists
  but is unusable — distinct from missing).

### Matching algorithm — ordered, consume-once, first-unconsumed-match-wins

For an incoming `(kind, name, input)`:

1. Scan recorded entries **in cassette order** for the first **not-yet-consumed** entry with
   matching `kind` + `name` whose input matches per its directive:
   - default → deep-equal `input`, skipping redaction-sentinel paths and any `match.ignore`
     paths;
   - `"name"` → input ignored.
2. Serve it — return `output`, or reconstruct and throw `error` — and mark the entry
   **consumed**.
3. No unconsumed match → miss → fall through to `onUnhandled`.

This single rule yields the behaviors discussed:

- **Retries** — a call recorded as `error` then `ok` is two entries with the same
  `name` + `input`; the first call consumes the error, the second the success. Same shape as
  the existing `sequence` stub.
- **Order-independence where it matters** — different-named calls match their own entries
  regardless of arrival order; only same-key duplicates consume in recorded order.
- **`stubbed` flag bookkeeping** — served-from-cassette → `stubbed: true`; fell-through →
  `false`. Unconsumed entries ("recorded but not called") are surfaced by the coverage helper,
  not the resolver.

## Reporting + order assertions

Built on the M1.1 assertion core (pure `{ pass, message() }`, no throw, no runner import).

**Queryable coverage state**, mirroring the existing `sequenceState()`:

```ts
harness.cassetteState(): {
  path: string;
  matched: Call[];          // served from the cassette
  missed:  Call[];          // fell through (not recorded) — the "didn't match" list
  unused:  RecordedEntry[]; // recorded entries never consumed
}
```

Computed from the cassette resolver's own consumption tracking — **not** the trajectory's
`stubbed` flag — so it stays accurate even when explicit `stubs` are also present (which would
also read `stubbed: true`).

**One coverage assertion helper**, in the `assert.ts` family:

```ts
expectCassetteFullyUsed(harness.cassetteState())
// pass iff missed.length === 0 && unused.length === 0
// message() lists each miss and each unused entry via the existing per-call diff renderer
```

Complementary to sealing: `onUnhandled: "error"` enforces *no misses at runtime*;
`expectCassetteFullyUsed` is the after-the-fact report that also catches **unused** entries (a
regression a runtime seal cannot see).

**Order** — no new matcher. The cassette's `calls` array *is* an ordered expected trajectory;
a thin adapter turns it into the `ExpectedCall[]` the M1.1 helpers already consume:

```ts
expectExactTrajectory(harness.trajectory, cassetteExpectedCalls(harness));  // strict order
expectSubsequence(harness.trajectory, [...]);                               // loose order
```

"Strict vs any order" is purely *which existing helper you call* — order is asserted, never
enforced by the resolver.

## Error handling & edge cases

| Situation | Behavior |
|---|---|
| Cassette file missing | Empty overlay, all calls hit `onUnhandled` + one-time warn |
| Malformed cassette JSON | Hard throw at load with path + parse error |
| Unknown/newer `mockist_format_version` | Hard throw — version mismatch, never silently misread |
| Entry with both or neither `output`/`error` | Validation throw at load |
| `match.ignore` path not present | Silent no-op |
| Recorded `error` | Replays as `new Error(message)` + `.name` — not the original subclass/custom props (documented) |
| Non-JSON-serializable output at record (function, circular ref, BigInt) | Hard throw at flush naming the call + path — fail loud, never write a lossy cassette |
| Record mode + configured `onUnhandled: "error"` | Forced to passthrough; one-time warn |
| Flush write failure (dir perms, etc.) | Throw with path + cause |
| Concurrent in-flight calls sharing a key | Same single-threaded-test assumption as `sequence` stubs (documented, not engineered around) |

## Public API additions

- `HarnessOptions.cassette?: string`
- `Harness.cassetteState(): CassetteState` (+ exported `CassetteState`, `RecordedEntry` types)
- `Harness.save(): Promise<void>` — writes in record mode, no-op in replay (used by the setup
  hook; also callable directly)
- `expectCassetteFullyUsed(state): AssertionResult`
- `cassetteExpectedCalls(harness): ExpectedCall[]`
- Runner setup modules: `mockist/vitest-setup`, `mockist/jest-setup`
- Optional CLI sugar: `mockist record <test-pattern>` (sets `MOCKIST_RECORD`, runs the test cmd)
- Default redactor (exported, overridable via the existing `redact` hook)

## Testing approach (TDD, vitest, `test/`)

- **Cassette resolver (unit):** exact match; `"name"` match; `ignore`-paths; redaction-sentinel
  wildcard; consume-once + retry (two same-key entries); miss → `undefined`.
- **Fixture load (unit):** valid; malformed JSON; bad version; invalid entry (both/neither
  `output`/`error`).
- **Redaction (unit):** default redactor scrubs known keys → sentinels; manifest built by scan;
  both-sides matching — a redacted input still matches the real incoming input.
- **Record flow (unit):** env-gated; forced passthrough; flush writes sorted-key JSON + creates
  dirs; flush is a no-op in replay; non-serializable output throws.
- **Reporting (unit):** `cassetteState()` matched/missed/unused; `expectCassetteFullyUsed`
  pass/fail + message; `cassetteExpectedCalls` → `expectExactTrajectory`.
- **Integration (e2e):** round-trip with `MockLanguageModelV3` + `wrapVercelTools` (as in
  `test/e2e-vercel.test.ts`) — record produces a cassette, a second replay run consumes it,
  trajectory matches and coverage is full.

## Out of scope (deferred)

- Dependency replay inside `execute` (HTTP/Prisma/queue) — the moat, M2/Gate 2.
- Convention-derived cassette paths from test names (runner-specific glue, not core).
- Write-if-changed / fixture diffing on re-record.
- Cross-model re-record / CI GitHub Action (M3).
