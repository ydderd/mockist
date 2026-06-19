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

test("a sequence stub records retry-style failure then success", async () => {
  const harness = createHarness({
    stubs: [{
      name: "flaky",
      sequence: [{ error: new Error("503") }, { result: "ok" }],
    }],
  });
  const original = vi.fn(async () => "real");

  await expect(harness.dispatch("tool", "flaky", {}, original)).rejects.toThrow("503");
  await expect(harness.dispatch("tool", "flaky", {}, original)).resolves.toBe("ok");

  expect(original).not.toHaveBeenCalled();
  expect(harness.trajectory).toHaveLength(2);
  expect(harness.trajectory[0]).toMatchObject({ name: "flaky", stubbed: true });
  expect(harness.trajectory[0]!.error).toBeInstanceOf(Error);
  expect(harness.trajectory[1]).toMatchObject({ name: "flaky", stubbed: true, output: "ok" });
});

test("an exhausted sequence can pass through to original", async () => {
  const harness = createHarness({
    stubs: [{
      name: "eventually-real",
      sequence: [{ result: "stubbed" }],
      onSequenceExhausted: "passthrough",
    }],
  });
  const original = vi.fn(async () => "real");

  await expect(harness.dispatch("tool", "eventually-real", {}, original)).resolves.toBe("stubbed");
  await expect(harness.dispatch("tool", "eventually-real", {}, original)).resolves.toBe("real");

  expect(original).toHaveBeenCalledTimes(1);
  expect(harness.trajectory[0]).toMatchObject({ name: "eventually-real", stubbed: true });
  expect(harness.trajectory[1]).toMatchObject({ name: "eventually-real", stubbed: false });
});

test("an exhausted passthrough sequence runs original even when onUnhandled is 'error'", async () => {
  const harness = createHarness({
    onUnhandled: "error",
    stubs: [{
      name: "eventually-real",
      sequence: [{ result: "stubbed" }],
      onSequenceExhausted: "passthrough",
    }],
  });
  const original = vi.fn(async () => "real");

  await expect(harness.dispatch("tool", "eventually-real", {}, original)).resolves.toBe("stubbed");
  // The call matched a stub whose passthrough mode means "defer to the real tool" — the
  // global onUnhandled:'error' policy must not hijack it into an unhandled-call throw.
  await expect(harness.dispatch("tool", "eventually-real", {}, original)).resolves.toBe("real");

  expect(original).toHaveBeenCalledTimes(1);
  expect(harness.trajectory[1]).toMatchObject({ name: "eventually-real", stubbed: false, output: "real" });
});

test("a stub defining neither result nor sequence records a stubbed failure", async () => {
  // @ts-expect-error — intentionally malformed stub: no result, no sequence.
  const harness = createHarness({ stubs: [{ name: "bad" }] });
  const original = vi.fn(async () => "real");

  await expect(harness.dispatch("tool", "bad", { a: 1 }, original)).rejects.toThrow(/must define result or sequence/);
  expect(original).not.toHaveBeenCalled();
  expect(harness.trajectory).toHaveLength(1);
  expect(harness.trajectory[0]).toMatchObject({ name: "bad", input: { a: 1 }, stubbed: true });
  expect(harness.trajectory[0]!.error).toBeInstanceOf(Error);
});

test("an empty sequence stub records a stubbed failure", async () => {
  const harness = createHarness({ stubs: [{ name: "empty", sequence: [] }] });
  const original = vi.fn(async () => "real");

  await expect(harness.dispatch("tool", "empty", {}, original)).rejects.toThrow(/at least one step/);
  expect(original).not.toHaveBeenCalled();
  expect(harness.trajectory).toHaveLength(1);
  expect(harness.trajectory[0]).toMatchObject({ name: "empty", stubbed: true });
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

test("onUnhandled 'error' still records the offending call before throwing", async () => {
  const harness = createHarness({ onUnhandled: "error" });
  const original = vi.fn(async () => "real");
  await expect(harness.dispatch("tool", "x", { a: 1 }, original)).rejects.toThrow(/unhandled/);
  expect(harness.trajectory).toHaveLength(1);
  expect(harness.trajectory[0]).toMatchObject({ name: "x", input: { a: 1 }, stubbed: false });
  expect(harness.trajectory[0]!.error).toBeInstanceOf(Error);
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

test("sequenceState reports consumption and exhaustion of sequence stubs", async () => {
  const harness = createHarness({
    stubs: [
      { name: "flaky", sequence: [{ result: "a" }, { result: "b" }], onSequenceExhausted: "repeat-last" },
      { name: "plain", result: 1 },
    ],
  });
  const original = vi.fn(async () => "real");

  // Nothing consumed yet.
  expect(harness.sequenceState()).toEqual([
    { name: "flaky", kind: "tool", length: 2, consumed: 0, exhausted: false },
  ]);

  await harness.dispatch("tool", "flaky", {}, original);
  await harness.dispatch("tool", "flaky", {}, original);
  expect(harness.sequenceState()[0]).toMatchObject({ consumed: 2, exhausted: false });

  // One more matching call drains it.
  await harness.dispatch("tool", "flaky", {}, original);
  expect(harness.sequenceState()[0]).toMatchObject({ consumed: 2, exhausted: true });
});

test("sequenceState resets with the harness", async () => {
  const harness = createHarness({ stubs: [{ name: "once", sequence: [{ result: "only" }] }] });
  await harness.dispatch("tool", "once", {}, async () => "real");
  expect(harness.sequenceState()[0]).toMatchObject({ consumed: 1 });
  harness.reset();
  expect(harness.sequenceState()[0]).toMatchObject({ consumed: 0, exhausted: false });
});

test("reset rewinds sequence stub cursors", async () => {
  const harness = createHarness({
    stubs: [{
      name: "flaky",
      sequence: [{ error: new Error("503") }, { result: "ok" }],
    }],
  });
  const original = vi.fn(async () => "real");

  await expect(harness.dispatch("tool", "flaky", {}, original)).rejects.toThrow("503");
  await expect(harness.dispatch("tool", "flaky", {}, original)).resolves.toBe("ok");

  harness.reset();

  await expect(harness.dispatch("tool", "flaky", {}, original)).rejects.toThrow("503");
  await expect(harness.dispatch("tool", "flaky", {}, original)).resolves.toBe("ok");
});

test("resolveCall matches stubs without recording", async () => {
  const harness = createHarness({ stubs: [{ name: "w", args: { city: "Paris" }, result: { tempC: 21 } }] });
  const hit = await harness.resolveCall("tool", "w", { city: "Paris" });
  expect(hit).toMatchObject({ matched: true });
  expect(await (hit as { produce: () => Promise<unknown> }).produce()).toEqual({ tempC: 21 });
  expect(harness.trajectory).toHaveLength(0);
  expect(await harness.resolveCall("tool", "w", { city: "Berlin" })).toEqual({ matched: false });
});

test("resolveCall does not advance sequence stubs until produce runs", async () => {
  const harness = createHarness({
    stubs: [{ name: "retry", sequence: [{ result: "first" }, { result: "second" }] }],
  });
  const hit = await harness.resolveCall("tool", "retry", {});
  expect(harness.sequenceState()[0]?.consumed).toBe(0);
  expect(await (hit as { produce: () => Promise<unknown> }).produce()).toBe("first");
  expect(harness.sequenceState()[0]?.consumed).toBe(1);
  expect(harness.trajectory).toHaveLength(0);
});

test("resolveCall onUnhandled error records call before throwing", async () => {
  const harness = createHarness({ onUnhandled: "error" });
  await expect(harness.resolveCall("tool", "x", { a: 1 })).rejects.toThrow(/unhandled/);
  expect(harness.trajectory).toHaveLength(1);
  expect(harness.trajectory[0]).toMatchObject({ name: "x", input: { a: 1 }, stubbed: false });
  expect(harness.trajectory[0]!.error).toBeInstanceOf(Error);
});

test("captureCall records trajectory without running resolvers", async () => {
  const harness = createHarness({ stubs: [{ name: "w", result: "stub" }] });
  harness.captureCall("tool", "w", {}, { stubbed: false, output: "real" });
  expect(harness.trajectory[0]).toMatchObject({ stubbed: false, output: "real" });
});
