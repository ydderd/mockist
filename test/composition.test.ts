import { describe, expect, test } from "vitest";
import { createHarness, concatTrajectories, mergeHarnessTrajectories } from "../src";
import type { Call } from "../src";

function call(partial: Partial<Call> & Pick<Call, "name">): Call {
  return {
    kind: "tool",
    input: {},
    stubbed: true,
    ts: 0,
    key: partial.name,
    ...partial,
  };
}

describe("concatTrajectories", () => {
  test("returns empty array for no segments", () => {
    expect(concatTrajectories()).toEqual([]);
  });

  test("concatenates segments in order", () => {
    const parent = [call({ name: "context_recall", ts: 1 }), call({ name: "delegate", ts: 2 })];
    const child = [call({ name: "search", ts: 3 }), call({ name: "summarize", ts: 4 })];
    const tail = [call({ name: "send_reply", ts: 5 })];

    expect(concatTrajectories(parent, child, tail).map((c) => c.name)).toEqual([
      "context_recall",
      "delegate",
      "search",
      "summarize",
      "send_reply",
    ]);
  });

  test("does not sort by timestamp — explicit segment order wins", () => {
    const a = [call({ name: "later", ts: 100 })];
    const b = [call({ name: "earlier", ts: 1 })];
    expect(concatTrajectories(a, b).map((c) => c.name)).toEqual(["later", "earlier"]);
  });
});

describe("mergeHarnessTrajectories", () => {
  test("merges harness trajectories in argument order", async () => {
    const parent = createHarness();
    const child = createHarness();

    await parent.dispatch("tool", "plan", {}, async () => "ok");
    parent.recordCall("subagent", "researcher", { task: "find docs" });
    await child.dispatch("tool", "search", {}, async () => ({ hits: [] }));

    const merged = mergeHarnessTrajectories(parent, child);
    expect(merged.map((c) => c.name)).toEqual(["plan", "researcher", "search"]);
    expect(merged[1]).toMatchObject({ kind: "subagent", stubbed: true });
  });
});

describe("harness.recordCall", () => {
  test("records a subagent boundary without dispatching", () => {
    const harness = createHarness();
    harness.recordCall("subagent", "researcher", { task: "billing" }, { stubbed: true, output: { ok: true } });

    expect(harness.trajectory).toHaveLength(1);
    expect(harness.trajectory[0]).toMatchObject({
      kind: "subagent",
      name: "researcher",
      input: { task: "billing" },
      output: { ok: true },
      stubbed: true,
    });
  });
});
