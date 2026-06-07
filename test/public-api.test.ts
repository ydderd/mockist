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
