import { expect, test } from "vitest";
import * as mockist from "../src/index";

test("exports the expected surface", () => {
  expect(typeof mockist.createHarness).toBe("function");
  expect(typeof mockist.defineStubs).toBe("function");
  expect(typeof mockist.wrapVercelTools).toBe("function");
  expect(typeof mockist.createClaudeAgentHooks).toBe("function");
  expect(typeof mockist.wrapMcpHandlers).toBe("function");
  expect(typeof mockist.wrapMcpToolHandler).toBe("function");
  expect(typeof mockist.createMcpClientInterceptor).toBe("function");
  expect(typeof mockist.wrapOpenAiTools).toBe("function");
  expect(typeof mockist.createOpenAiToolInterceptor).toBe("function");
  expect(typeof mockist.concatTrajectories).toBe("function");
  expect(typeof mockist.mergeHarnessTrajectories).toBe("function");
  expect(typeof mockist.identify).toBe("function");
  expect(typeof mockist.validateStubsAgainstSchemas).toBe("function");
  expect(typeof mockist.stubsFromSchemas).toBe("function");
  expect(typeof mockist.mockistMatchers).toBe("function");
});

test("composes end to end", async () => {
  const harness = mockist.createHarness({ stubs: mockist.defineStubs([{ name: "ping", result: "pong" }]) });
  const wrapped = mockist.wrapVercelTools({ ping: { execute: async () => "real" } }, harness);
  expect(await wrapped.ping.execute!()).toBe("pong");
});

test("cassette public API is exported", () => {
  expect(typeof mockist.expectCassetteFullyUsed).toBe("function");
  expect(typeof mockist.cassetteExpectedCalls).toBe("function");
  expect(typeof mockist.defaultRedactor).toBe("function");
  expect(mockist.CASSETTE_FORMAT_VERSION).toBe(1);
});

test("harness exposes resolveCall for hook adapters", async () => {
  const harness = mockist.createHarness({ stubs: [{ name: "ping", result: "pong" }] });
  const resolved = await harness.resolveCall("tool", "ping", {});
  expect(resolved).toMatchObject({ matched: true });
  expect(await (resolved as { produce: () => Promise<unknown> }).produce()).toBe("pong");
  expect(harness.trajectory).toHaveLength(0);
});
