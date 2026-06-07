import { expect, test } from "vitest";
import * as mockist from "../src/index";

test("exports the expected surface", () => {
  expect(typeof mockist.createHarness).toBe("function");
  expect(typeof mockist.defineStubs).toBe("function");
  expect(typeof mockist.wrapVercelTools).toBe("function");
  expect(typeof mockist.identify).toBe("function");
});

test("composes end to end", async () => {
  const harness = mockist.createHarness({ stubs: mockist.defineStubs([{ name: "ping", result: "pong" }]) });
  const wrapped = mockist.wrapVercelTools({ ping: { execute: async () => "real" } }, harness);
  expect(await wrapped.ping.execute!()).toBe("pong");
});
