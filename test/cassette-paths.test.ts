import { expect, test } from "vitest";
import { parsePath, blankPaths, findRedactedPaths } from "../src/core/cassette/paths";

test("parsePath splits names and array indices", () => {
  expect(parsePath("input.items[0].id")).toEqual(["input", "items", 0, "id"]);
  expect(parsePath("input.requestId")).toEqual(["input", "requestId"]);
});

test("blankPaths removes existing paths so differing values neutralize", () => {
  const a = blankPaths({ input: { q: "x", requestId: "abc" } }, ["input.requestId"]);
  const b = blankPaths({ input: { q: "x", requestId: "zzz" } }, ["input.requestId"]);
  expect(a).toEqual(b);
  expect((a as any).input.q).toBe("x");
  expect((a as any).input.requestId).toBeUndefined();
});

test("blankPaths is a no-op for paths that do not exist", () => {
  const out = blankPaths({ input: { q: "x" } }, ["input.missing"]);
  expect(out).toEqual({ input: { q: "x" } });
});

test("findRedactedPaths reports sentinel paths under a base", () => {
  const paths = findRedactedPaths({ headers: { authorization: "[REDACTED:authorization]" }, q: "x" }, "input");
  expect(paths).toEqual(["input.headers.authorization"]);
});
