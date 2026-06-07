# Tool-Stub Harness — Implementation Plan

> **For agentic workers:** use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use `- [ ]`.

**Spec:** `docs/superpowers/specs/2026-06-06-declarative-tool-stub-harness-design.md`
**Goal:** A TypeScript library that stubs Vercel AI SDK tool calls — a stubbed call returns a canned value or throws, any other call runs the real tool, and every call is recorded for assertions.
**Stack (pinned to current):** TypeScript 6, Vitest 4, `ai` 6 + `zod` 4 (end-to-end test only), Node ≥ 20.
**Build order:** scaffold → types/identity → registry → recorder → harness → adapter → public API → end-to-end → README.

Only the end-to-end task (Task 8) touches the `ai` SDK; Tasks 2–7 are pure TypeScript.

---

### Task 1: Scaffold

**Files:**
- Create/replace: `package.json`
- Create: `tsconfig.json`, `.gitignore`
- Test: `test/smoke.test.ts`

`ai` and `zod` are already installed in this repo. `ai` is both a peer dependency (for the published package) and a dev dependency (for our own end-to-end test).

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "toolest",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "ai": "^6.0.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^25.9.2",
    "ai": "^6.0.197",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8",
    "zod": "^4.4.3"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "declaration": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules
dist
*.log
```

- [ ] **Step 4: Write `test/smoke.test.ts`**

```ts
import { expect, test } from "vitest";

test("smoke: test runner works", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 5: Install dev tooling and run the smoke test**

Run: `npm install && npm test`
Expected: install succeeds; 1 passed (`test/smoke.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore test/smoke.test.ts
git commit -m "chore: scaffold TS package with vitest, ai 6, zod 4"
```

---

### Task 2: Core types + call-identity

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/identity.ts`
- Test: `test/identity.test.ts`

- [ ] **Step 1: Write `src/core/types.ts`** (pure types; verified by `typecheck`)

```ts
export type CallKind = "tool" | "skill" | "subagent";

/** A normalized record of one call. Shared by the recorder; reusable as a fixture later. */
export interface Call {
  kind: CallKind;
  name: string;
  input: unknown;
  output?: unknown;
  error?: unknown;
  /** true if a resolver supplied the result; false if the real `original` ran. */
  stubbed: boolean;
  ts: number;
  /** stable identity from `identify()`. */
  key: string;
}

/** A stub's result: a literal value, or a function of the input. May be async. May throw. */
export type StubResult =
  | unknown
  | ((input: any) => unknown | Promise<unknown>);

/** A declarative stub. Matches on name + (predicate | args | name-only). */
export interface Stub {
  /** defaults to "tool". */
  kind?: CallKind;
  name: string;
  /** exact-args match: deep-equals the call input. */
  args?: unknown;
  /** predicate match; takes precedence over `args` when present. */
  match?: (input: any) => boolean;
  result: StubResult;
}

/**
 * A resolver returns a Resolution on a hit, or undefined to defer to the next resolver.
 * `produce` is a thunk so its invocation (and any throw from a result function) happens
 * inside the harness — letting a throwing stub be recorded as a failure, not crash matching.
 */
export interface Resolution {
  produce: () => unknown | Promise<unknown>;
}
export type ResolverInput = Pick<Call, "kind" | "name" | "input">;
export type Resolver = (call: ResolverInput) => Resolution | undefined;

/** What to do when no resolver matches a call. */
export type UnhandledPolicy = "passthrough" | "warn" | "error";
```

- [ ] **Step 2: Write the failing test**

```ts
import { expect, test } from "vitest";
import { identify, stableStringify } from "../src/core/identity";

test("identify is stable regardless of object key order", () => {
  expect(identify("tool", "w", { city: "Paris", units: "c" }))
    .toBe(identify("tool", "w", { units: "c", city: "Paris" }));
});

test("identify distinguishes kind, name, and input", () => {
  expect(identify("tool", "x", { a: 1 })).not.toBe(identify("skill", "x", { a: 1 }));
  expect(identify("tool", "x", { a: 1 })).not.toBe(identify("tool", "y", { a: 1 }));
  expect(identify("tool", "x", { a: 1 })).not.toBe(identify("tool", "x", { a: 2 }));
});

test("stableStringify sorts nested keys and handles arrays/null", () => {
  expect(stableStringify({ b: 1, a: [3, { y: 2, x: 1 }] })).toBe('{"a":[3,{"x":1,"y":2}],"b":1}');
  expect(stableStringify(null)).toBe("null");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/identity.test.ts`
Expected: FAIL — cannot resolve `../src/core/identity`.

- [ ] **Step 4: Write `src/core/identity.ts`**

```ts
import type { CallKind } from "./types";

/** Deterministic JSON: object keys sorted recursively. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Stable identity for a call; used for recording and (later) fixture keys. */
export function identify(kind: CallKind, name: string, input: unknown): string {
  return `${kind}:${name}:${stableStringify(input)}`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/identity.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/identity.ts test/identity.test.ts
git commit -m "feat: core types and stable call-identity"
```

---

### Task 3: Stub registry + predicate resolver

**Files:**
- Create: `src/core/deep-equal.ts`
- Create: `src/core/registry.ts`
- Test: `test/registry.test.ts`

The resolver returns a `produce` thunk and does **not** invoke a result function during matching — so a stub that throws is handled later by the harness as a recorded failure.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test, vi } from "vitest";
import { defineStubs, predicateResolver } from "../src/core/registry";

test("name-only stub matches any input for that name", () => {
  const resolve = predicateResolver(defineStubs([{ name: "ping", result: "pong" }]));
  expect(resolve({ kind: "tool", name: "ping", input: { a: 1 } })?.produce()).toBe("pong");
  expect(resolve({ kind: "tool", name: "ping", input: { a: 2 } })?.produce()).toBe("pong");
});

test("name+args stub matches only on deep-equal input", () => {
  const resolve = predicateResolver(defineStubs([{ name: "w", args: { city: "Paris" }, result: 21 }]));
  expect(resolve({ kind: "tool", name: "w", input: { city: "Paris" } })?.produce()).toBe(21);
  expect(resolve({ kind: "tool", name: "w", input: { city: "Berlin" } })).toBeUndefined();
});

test("predicate match takes precedence over args", () => {
  const resolve = predicateResolver(defineStubs([{ name: "w", match: (i) => i.city.startsWith("P"), result: 9 }]));
  expect(resolve({ kind: "tool", name: "w", input: { city: "Prague" } })?.produce()).toBe(9);
  expect(resolve({ kind: "tool", name: "w", input: { city: "Oslo" } })).toBeUndefined();
});

test("result functions run only when produced, with the input", () => {
  const fn = vi.fn((i: { msg: string }) => i.msg.toUpperCase());
  const resolve = predicateResolver(defineStubs([{ name: "echo", result: fn }]));
  const hit = resolve({ kind: "tool", name: "echo", input: { msg: "hi" } });
  expect(fn).not.toHaveBeenCalled(); // not invoked during matching
  expect(hit?.produce()).toBe("HI");
  expect(fn).toHaveBeenCalledTimes(1);
});

test("a throwing result function does not throw during matching", () => {
  const resolve = predicateResolver(defineStubs([{ name: "boom", result: () => { throw new Error("x"); } }]));
  const hit = resolve({ kind: "tool", name: "boom", input: {} });
  expect(hit).toBeDefined();          // matching succeeds
  expect(() => hit!.produce()).toThrow("x"); // throwing is deferred to produce()
});

test("kind must match (default kind is tool); first match wins", () => {
  const resolve = predicateResolver(defineStubs([
    { name: "x", args: { a: 1 }, result: "first" },
    { name: "x", result: "second" },
  ]));
  expect(resolve({ kind: "tool", name: "x", input: { a: 1 } })?.produce()).toBe("first");
  expect(resolve({ kind: "tool", name: "x", input: { a: 2 } })?.produce()).toBe("second");
  expect(resolve({ kind: "skill", name: "x", input: { a: 1 } })).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/registry.test.ts`
Expected: FAIL — cannot resolve `../src/core/registry`.

- [ ] **Step 3: Write `src/core/deep-equal.ts`**

```ts
import { stableStringify } from "./identity";

/** Structural equality via canonical JSON (reuses the identity normalizer). */
export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}
```

- [ ] **Step 4: Write `src/core/registry.ts`**

```ts
import type { Resolver, Stub } from "./types";
import { deepEqual } from "./deep-equal";

/** Identity helper for authoring a typed stub list. */
export function defineStubs(stubs: Stub[]): Stub[] {
  return stubs;
}

/** First stub matching name + (predicate | args | name-only) wins; returns a produce thunk. */
export function predicateResolver(stubs: Stub[]): Resolver {
  return ({ kind, name, input }) => {
    for (const stub of stubs) {
      const stubKind = stub.kind ?? "tool";
      if (stubKind !== kind || stub.name !== name) continue;

      const matches = stub.match
        ? stub.match(input)
        : stub.args !== undefined
          ? deepEqual(input, stub.args)
          : true;
      if (!matches) continue;

      return {
        produce: () =>
          typeof stub.result === "function"
            ? (stub.result as (input: unknown) => unknown)(input)
            : stub.result,
      };
    }
    return undefined;
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/registry.test.ts`
Expected: PASS — 6 passed.

- [ ] **Step 6: Commit**

```bash
git add src/core/deep-equal.ts src/core/registry.ts test/registry.test.ts
git commit -m "feat: stub registry with name+args matching and deferred produce"
```

---

### Task 4: Recorder with redaction hook

**Files:**
- Create: `src/core/recorder.ts`
- Test: `test/recorder.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { Recorder } from "../src/core/recorder";
import type { Call } from "../src/core/types";

function call(partial: Partial<Call>): Call {
  return { kind: "tool", name: "x", input: {}, stubbed: false, ts: 0, key: "k", ...partial };
}

test("records calls in order and exposes the trajectory", () => {
  const rec = new Recorder();
  rec.record(call({ name: "a" }));
  rec.record(call({ name: "b" }));
  expect(rec.trajectory.map((c) => c.name)).toEqual(["a", "b"]);
});

test("reset clears the trajectory", () => {
  const rec = new Recorder();
  rec.record(call({}));
  rec.reset();
  expect(rec.trajectory).toHaveLength(0);
});

test("redactor is applied before storing (no-op by default)", () => {
  const rec = new Recorder((c) => ({ ...c, input: "[redacted]" }));
  rec.record(call({ input: { secret: "shh" } }));
  expect(rec.trajectory[0]!.input).toBe("[redacted]");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/recorder.test.ts`
Expected: FAIL — cannot resolve `../src/core/recorder`.

- [ ] **Step 3: Write `src/core/recorder.ts`**

```ts
import type { Call } from "./types";

/** Transforms a call before it is stored. Default is identity (no-op). */
export type Redactor = (call: Call) => Call;

/** In-memory trajectory of observed calls. */
export class Recorder {
  private calls: Call[] = [];
  private readonly redact: Redactor;

  constructor(redact: Redactor = (c) => c) {
    this.redact = redact;
  }

  record(call: Call): void {
    this.calls.push(this.redact(call));
  }

  get trajectory(): readonly Call[] {
    return this.calls;
  }

  reset(): void {
    this.calls = [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/recorder.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/recorder.ts test/recorder.test.ts
git commit -m "feat: in-memory recorder with redaction hook"
```

---

### Task 5: Harness — dispatch, unhandled policy, failure injection, query helpers

**Files:**
- Create: `src/core/harness.ts`
- Test: `test/harness.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test, vi } from "vitest";
import { createHarness } from "../src/core/harness";

test("a stub hit returns the value and never calls original", async () => {
  const harness = createHarness({ stubs: [{ name: "w", args: { city: "Paris" }, result: { tempC: 21 } }] });
  const original = vi.fn(async () => ({ tempC: 99 }));
  const out = await harness.dispatch("tool", "w", { city: "Paris" }, original);
  expect(out).toEqual({ tempC: 21 });
  expect(original).not.toHaveBeenCalled();
  expect(harness.trajectory[0]).toMatchObject({ name: "w", stubbed: true, output: { tempC: 21 } });
});

test("a miss passes through to original and records stubbed=false", async () => {
  const harness = createHarness({ stubs: [{ name: "w", args: { city: "Paris" }, result: 1 }] });
  const original = vi.fn(async () => ({ tempC: 99 }));
  const out = await harness.dispatch("tool", "w", { city: "Berlin" }, original);
  expect(out).toEqual({ tempC: 99 });
  expect(original).toHaveBeenCalledTimes(1);
  expect(harness.trajectory[0]).toMatchObject({ name: "w", stubbed: false, output: { tempC: 99 } });
});

test("async stub values are awaited", async () => {
  const harness = createHarness({ stubs: [{ name: "slow", result: async () => "ready" }] });
  expect(await harness.dispatch("tool", "slow", {}, async () => "real")).toBe("ready");
});

test("a throwing stub is recorded as a stubbed failure and rethrown", async () => {
  const harness = createHarness({ stubs: [{ name: "flaky", result: () => { throw new Error("503"); } }] });
  const original = vi.fn(async () => "real");
  await expect(harness.dispatch("tool", "flaky", {}, original)).rejects.toThrow("503");
  expect(original).not.toHaveBeenCalled();
  expect(harness.trajectory[0]).toMatchObject({ name: "flaky", stubbed: true });
  expect(harness.trajectory[0]!.error).toBeInstanceOf(Error);
});

test("errors from original (pass-through) are recorded and rethrown", async () => {
  const harness = createHarness();
  await expect(harness.dispatch("tool", "x", {}, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  expect(harness.trajectory[0]).toMatchObject({ name: "x", stubbed: false });
});

test("onUnhandled 'error' throws on an un-stubbed call without running original", async () => {
  const harness = createHarness({ onUnhandled: "error" });
  const original = vi.fn(async () => "real");
  await expect(harness.dispatch("tool", "x", {}, original)).rejects.toThrow(/unhandled/);
  expect(original).not.toHaveBeenCalled();
});

test("onUnhandled 'warn' warns then passes through", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const harness = createHarness({ onUnhandled: "warn" });
  const out = await harness.dispatch("tool", "x", {}, async () => "real");
  expect(out).toBe("real");
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

test("extra resolvers run after stubs, before pass-through", async () => {
  const harness = createHarness({
    resolvers: [({ name }) => (name === "fx" ? { produce: () => "from-resolver" } : undefined)],
  });
  expect(await harness.dispatch("tool", "fx", {}, async () => "real")).toBe("from-resolver");
});

test("callsTo and calledWith query the trajectory", async () => {
  const harness = createHarness({ stubs: [{ name: "w", result: 1 }] });
  await harness.dispatch("tool", "w", { city: "Paris" }, async () => 0);
  await harness.dispatch("tool", "w", { city: "Berlin" }, async () => 0);
  expect(harness.callsTo("w")).toHaveLength(2);
  expect(harness.calledWith("w", { city: "Paris" })).toBe(true);
  expect(harness.calledWith("w", { city: "Oslo" })).toBe(false);
});

test("reset clears the trajectory", async () => {
  const harness = createHarness();
  await harness.dispatch("tool", "x", {}, async () => 1);
  harness.reset();
  expect(harness.trajectory).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/harness.test.ts`
Expected: FAIL — cannot resolve `../src/core/harness`.

- [ ] **Step 3: Write `src/core/harness.ts`**

```ts
import type { Call, CallKind, Resolver, Stub, UnhandledPolicy } from "./types";
import { predicateResolver } from "./registry";
import { Recorder, type Redactor } from "./recorder";
import { deepEqual } from "./deep-equal";
import { identify } from "./identity";

export interface HarnessOptions {
  /** Hand-authored stubs. */
  stubs?: Stub[];
  /** Extra resolvers, appended AFTER the stub resolver. */
  resolvers?: Resolver[];
  /** What to do on an un-stubbed call. Default "passthrough". */
  onUnhandled?: UnhandledPolicy;
  /** Applied to every recorded call before storage. */
  redact?: Redactor;
}

export class Harness {
  readonly resolvers: Resolver[];
  private readonly recorder: Recorder;
  private readonly onUnhandled: UnhandledPolicy;

  constructor(opts: HarnessOptions = {}) {
    this.resolvers = [predicateResolver(opts.stubs ?? []), ...(opts.resolvers ?? [])];
    this.recorder = new Recorder(opts.redact);
    this.onUnhandled = opts.onUnhandled ?? "passthrough";
  }

  get trajectory(): readonly Call[] {
    return this.recorder.trajectory;
  }

  callsTo(name: string): Call[] {
    return this.trajectory.filter((c) => c.name === name);
  }

  calledWith(name: string, input: unknown): boolean {
    return this.trajectory.some((c) => c.name === name && deepEqual(c.input, input));
  }

  reset(): void {
    this.recorder.reset();
  }

  /**
   * Resolve a call: first matching resolver wins (stub); otherwise apply the
   * unhandled-call policy. Records the call (or failure) either way.
   */
  async dispatch(
    kind: CallKind,
    name: string,
    input: unknown,
    original: () => Promise<unknown>,
  ): Promise<unknown> {
    const key = identify(kind, name, input);

    for (const resolve of this.resolvers) {
      const hit = resolve({ kind, name, input });
      if (!hit) continue;
      try {
        const output = await hit.produce();
        this.push(kind, name, input, key, { stubbed: true, output });
        return output;
      } catch (error) {
        this.push(kind, name, input, key, { stubbed: true, error });
        throw error;
      }
    }

    if (this.onUnhandled === "error") {
      throw new Error(`toolest: unhandled ${kind} call "${name}" (onUnhandled: 'error')`);
    }
    if (this.onUnhandled === "warn") {
      console.warn(`toolest: unhandled ${kind} call "${name}" — passing through`);
    }

    try {
      const output = await original();
      this.push(kind, name, input, key, { stubbed: false, output });
      return output;
    } catch (error) {
      this.push(kind, name, input, key, { stubbed: false, error });
      throw error;
    }
  }

  private push(
    kind: CallKind,
    name: string,
    input: unknown,
    key: string,
    outcome: { stubbed: boolean; output?: unknown; error?: unknown },
  ): void {
    this.recorder.record({ kind, name, input, key, ts: Date.now(), ...outcome });
  }
}

export function createHarness(opts?: HarnessOptions): Harness {
  return new Harness(opts);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/harness.test.ts`
Expected: PASS — 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/harness.ts test/harness.test.ts
git commit -m "feat: harness with unhandled policy, failure injection, query helpers"
```

---

### Task 6: Vercel adapter — `wrapVercelTools`

**Files:**
- Create: `src/adapters/vercel.ts`
- Test: `test/vercel-adapter.test.ts`

Tested by invoking `execute` directly (as the SDK does), so it is deterministic and independent of the `ai` version.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test, vi } from "vitest";
import { createHarness } from "../src/core/harness";
import { wrapVercelTools } from "../src/adapters/vercel";

test("stubbed tool returns the canned value; real execute not called", async () => {
  const realExecute = vi.fn(async ({ city }: { city: string }) => ({ tempC: 99, city }));
  const harness = createHarness({ stubs: [{ name: "weather", args: { city: "Paris" }, result: { tempC: 21 } }] });
  const wrapped = wrapVercelTools({ weather: { description: "w", execute: realExecute } }, harness);
  expect(await wrapped.weather.execute!({ city: "Paris" }, {} as any)).toEqual({ tempC: 21 });
  expect(realExecute).not.toHaveBeenCalled();
  expect(harness.trajectory[0]).toMatchObject({ kind: "tool", name: "weather", stubbed: true });
});

test("unstubbed tool passes through to real execute", async () => {
  const realExecute = vi.fn(async ({ city }: { city: string }) => ({ tempC: 99, city }));
  const harness = createHarness({ stubs: [{ name: "weather", args: { city: "Paris" }, result: { tempC: 21 } }] });
  const wrapped = wrapVercelTools({ weather: { description: "w", execute: realExecute } }, harness);
  expect(await wrapped.weather.execute!({ city: "Berlin" }, {} as any)).toEqual({ tempC: 99, city: "Berlin" });
  expect(realExecute).toHaveBeenCalledTimes(1);
  expect(harness.trajectory[0]).toMatchObject({ name: "weather", stubbed: false });
});

test("tools without an execute are passed through untouched", () => {
  const clientTool = { description: "no execute" };
  const wrapped = wrapVercelTools({ ui: clientTool }, createHarness());
  expect(wrapped.ui).toBe(clientTool);
});

test("non-execute properties are preserved", () => {
  const wrapped = wrapVercelTools(
    { weather: { description: "desc", inputSchema: { marker: true }, execute: async () => 1 } },
    createHarness(),
  );
  expect(wrapped.weather.description).toBe("desc");
  expect((wrapped.weather as any).inputSchema).toEqual({ marker: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/vercel-adapter.test.ts`
Expected: FAIL — cannot resolve `../src/adapters/vercel`.

- [ ] **Step 3: Write `src/adapters/vercel.ts`**

```ts
import type { Harness } from "../core/harness";

/**
 * Structural type for a Vercel AI SDK tool. We avoid importing `ai`'s types so the
 * adapter stays version-tolerant: a tool is an object with an optional
 * `execute(input, options)`.
 */
type ToolLike = {
  execute?: (input: any, options: any) => unknown | Promise<unknown>;
  [key: string]: unknown;
};
type ToolSet = Record<string, ToolLike>;

/**
 * Wrap each tool's `execute` so calls route through the harness. Tools without an
 * `execute` (client-side / forwarded tools) are returned untouched.
 */
export function wrapVercelTools<T extends ToolSet>(tools: T, harness: Harness): T {
  const wrapped: ToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (typeof tool.execute !== "function") {
      wrapped[name] = tool;
      continue;
    }
    const originalExecute = tool.execute.bind(tool);
    wrapped[name] = {
      ...tool,
      execute: (input: unknown, options: unknown) =>
        harness.dispatch("tool", name, input, () => Promise.resolve(originalExecute(input, options))),
    };
  }
  return wrapped as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/vercel-adapter.test.ts`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/vercel.ts test/vercel-adapter.test.ts
git commit -m "feat: Vercel AI SDK adapter wrapping tool execute"
```

---

### Task 7: Public API

**Files:**
- Create: `src/index.ts`
- Test: `test/public-api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import * as toolest from "../src/index";

test("exports the expected surface", () => {
  expect(typeof toolest.createHarness).toBe("function");
  expect(typeof toolest.defineStubs).toBe("function");
  expect(typeof toolest.wrapVercelTools).toBe("function");
  expect(typeof toolest.identify).toBe("function");
});

test("composes end to end", async () => {
  const harness = toolest.createHarness({ stubs: toolest.defineStubs([{ name: "ping", result: "pong" }]) });
  const wrapped = toolest.wrapVercelTools({ ping: { execute: async () => "real" } }, harness);
  expect(await wrapped.ping.execute!({}, {} as any)).toBe("pong");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/public-api.test.ts`
Expected: FAIL — cannot resolve `../src/index`.

- [ ] **Step 3: Write `src/index.ts`**

```ts
export { createHarness, Harness, type HarnessOptions } from "./core/harness";
export { defineStubs, predicateResolver } from "./core/registry";
export { Recorder, type Redactor } from "./core/recorder";
export { identify, stableStringify } from "./core/identity";
export { deepEqual } from "./core/deep-equal";
export { wrapVercelTools } from "./adapters/vercel";
export type {
  Call,
  CallKind,
  Resolution,
  Resolver,
  ResolverInput,
  Stub,
  StubResult,
  UnhandledPolicy,
} from "./core/types";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/public-api.test.ts`
Expected: PASS — 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/public-api.test.ts
git commit -m "feat: public API surface"
```

---

### Task 8: End-to-end under the real Vercel AI SDK (ai 6)

**Files:**
- Test: `test/e2e-vercel.test.ts`

Proves the seam is in the right place: a real `generateText` loop, driven by `MockLanguageModelV3`, routes through our wrapped tools. The mock-model shape below matches `ai` 6 / `@ai-sdk/provider` 3 (tool-call part `input` is a stringified JSON; `finishReason` is `{ unified, raw }`; `usage` has nested `inputTokens`/`outputTokens`). If a future `ai` upgrade changes the spec, adjust ONLY the `USAGE`/`*Step` helpers — keep the assertions and all `src/` code unchanged.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { generateText, stepCountIs, tool } from "ai";
import { MockLanguageModelV3, mockValues } from "ai/test";
import { z } from "zod";
import { createHarness, wrapVercelTools } from "../src/index";

// V3 boilerplate, kept local to the test.
const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};
const toolCallStep = (toolName: string, input: unknown, id: string) => ({
  content: [{ type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});
const textStep = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});

function weatherTool(onExecute: () => void) {
  return {
    get_weather: tool({
      description: "Get the weather for a city",
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => { onExecute(); return { tempC: 99, city }; },
    }),
  };
}

test("stub is returned to the model loop; real execute never runs", async () => {
  let real = 0;
  const harness = createHarness({
    stubs: [{ name: "get_weather", args: { city: "Paris" }, result: { tempC: 21, city: "Paris" } }],
  });
  const model = new MockLanguageModelV3({
    doGenerate: mockValues(toolCallStep("get_weather", { city: "Paris" }, "c1"), textStep("It is 21C in Paris.")),
  });

  const result = await generateText({
    model,
    tools: wrapVercelTools(weatherTool(() => { real++; }), harness),
    prompt: "Weather in Paris?",
    stopWhen: stepCountIs(5),
  });

  expect(real).toBe(0);
  expect(result.text).toContain("21C");
  expect(harness.trajectory).toHaveLength(1);
  expect(harness.trajectory[0]).toMatchObject({ name: "get_weather", stubbed: true, output: { tempC: 21, city: "Paris" } });
});

test("unstubbed tool passes through to the real execute", async () => {
  let real = 0;
  const harness = createHarness({
    stubs: [{ name: "get_weather", args: { city: "Paris" }, result: { tempC: 21, city: "Paris" } }],
  });
  const model = new MockLanguageModelV3({
    doGenerate: mockValues(toolCallStep("get_weather", { city: "Berlin" }, "c2"), textStep("done")),
  });

  await generateText({
    model,
    tools: wrapVercelTools(weatherTool(() => { real++; }), harness),
    prompt: "Weather in Berlin?",
    stopWhen: stepCountIs(5),
  });

  expect(real).toBe(1);
  expect(harness.trajectory[0]).toMatchObject({ name: "get_weather", stubbed: false, output: { tempC: 99, city: "Berlin" } });
});

test("an error-injecting stub records the failure and the agent runs its failure path", async () => {
  let real = 0;
  const harness = createHarness({
    stubs: [{ name: "get_weather", result: () => { throw new Error("upstream 503"); } }],
  });
  const model = new MockLanguageModelV3({
    doGenerate: mockValues(toolCallStep("get_weather", { city: "Paris" }, "c3"), textStep("Sorry, weather is unavailable.")),
  });

  const result = await generateText({
    model,
    tools: wrapVercelTools(weatherTool(() => { real++; }), harness),
    prompt: "Weather in Paris?",
    stopWhen: stepCountIs(5),
  });

  expect(real).toBe(0);
  expect(harness.trajectory[0]).toMatchObject({ name: "get_weather", stubbed: true });
  expect(harness.trajectory[0]!.error).toBeInstanceOf(Error);
  expect(result.text).toContain("unavailable");
});
```

- [ ] **Step 2: Run test to verify it fails or needs shape adjustment**

Run: `npx vitest run test/e2e-vercel.test.ts`
Expected: PASS if the installed `ai` matches the V3 shape above. If it fails on the mock-model shape, adjust ONLY the `USAGE`/`toolCallStep`/`textStep` helpers to match the installed `@ai-sdk/provider` spec (check `node_modules/@ai-sdk/provider/dist/index.d.ts` for `LanguageModelV*Usage` / `*FinishReason` / `*ToolCall`). Do not change the assertions or any `src/` code.

- [ ] **Step 3: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all test files PASS; `tsc --noEmit` reports no errors.

- [ ] **Step 4: Commit**

```bash
git add test/e2e-vercel.test.ts
git commit -m "test: end-to-end stub, pass-through, and failure injection under ai 6"
```

---

### Task 9: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# toolest (working name)

Stub the tool calls your agent makes through the Vercel AI SDK. A stubbed call
returns a canned value (or throws); any other call runs the real tool. Every call
is recorded so you can assert what the agent did.

## Quick start

```ts
import { generateText } from "ai";
import { createHarness, wrapVercelTools } from "toolest";

const harness = createHarness({
  onUnhandled: "passthrough", // | "warn" | "error" (fail on any un-stubbed call)
  stubs: [
    { name: "get_weather", args: { city: "Paris" }, result: { tempC: 21 } }, // name + args
    { name: "search", match: (i) => i.q.includes("docs"), result: { hits: [] } }, // predicate
    { name: "flaky", result: () => { throw new Error("upstream 503"); } }, // failure
    { name: "now", result: "2026-06-07T00:00:00Z" }, // name only
  ],
});

const result = await generateText({
  model, // you supply this — a real model or the SDK's MockLanguageModelV3
  tools: wrapVercelTools(myTools, harness),
  prompt: "What's the weather in Paris?",
});

expect(harness.callsTo("get_weather")).toHaveLength(1);
expect(harness.trajectory[0]).toMatchObject({ name: "get_weather", stubbed: true });
```

## Matching

A stub matches when its `kind` (default `"tool"`) and `name` match the call, and:
its `match` predicate passes (if given), else its `args` deep-equal the input (if
given), else it matches the name regardless of input. First match wins. No match
runs the real `execute` (pass-through), unless `onUnhandled: "error"`.

## Assertions

`harness.trajectory` is a typed, read-only array of every call (`name`, `input`,
`output`/`error`, `stubbed`). Helpers: `harness.callsTo(name)`,
`harness.calledWith(name, input)`. Use your runner's own assertions. Call
`harness.reset()` between tests.

## Not yet (backlog)

Sequential stubs (`[error, then ok]`); recording real runs to generate stubs;
mocking dependencies inside a tool's `execute`; adapters for MCP / Anthropic /
OpenAI. See `docs/superpowers/specs/2026-06-06-declarative-tool-stub-harness-design.md`.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README"
```

---

## Self-Review

**Spec coverage:** Wrap (T6) · name+args matching (T3) · return/pass-through (T5,T6,T8) · failure injection (T3 deferred produce, T5 record+rethrow, T8) · trajectory (T4,T5) · plain-data assertions + `callsTo`/`calledWith` (T5,T8) · fidelity / no-execute passthrough (T6) · `onUnhandled` policy (T5) · reset (T4,T5). Extension seams: identity (T2), Call shape (T2), resolver pipeline (T5 extra-resolvers test), redaction hook (T4).

**Anchored on latest:** `ai`^6 / `zod`^4 pinned (T1); only T8 touches the SDK, using `MockLanguageModelV3` + `mockValues` + the V3 `finishReason`/`usage`/tool-call shapes.

**Type consistency:** `Call`, `Stub`, `Resolver`/`Resolution{produce}`, `UnhandledPolicy`, `identify`, `stableStringify`, `deepEqual`, `Recorder(redact)`, `createHarness`/`Harness.dispatch`/`callsTo`/`calledWith`/`reset`, `wrapVercelTools`, `defineStubs`, `predicateResolver` — consistent across Tasks 2–8 and the public API.

**Placeholder scan:** none. The only conditional content (T8 Step 2 shape-adjustment) is a concrete, scoped instruction.
