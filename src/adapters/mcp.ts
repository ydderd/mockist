import type { Harness } from "../core/harness";

/** MCP `tools/call` handler: receives tool arguments, returns structured content. */
export type McpToolHandler = (args: { arguments: unknown }) => unknown | Promise<unknown>;

export type McpHandlerMap = Record<string, McpToolHandler>;

/**
 * Wrap one MCP tool handler so invocations route through the harness at the tool boundary.
 */
export function wrapMcpToolHandler(
  harness: Harness,
  name: string,
  handler: McpToolHandler,
): McpToolHandler {
  return (args) =>
    harness.dispatch("tool", name, args.arguments, () =>
      Promise.resolve(handler(args)),
    );
}

/**
 * Wrap every handler in an MCP `tools/call` dispatch map.
 */
export function wrapMcpHandlers<T extends McpHandlerMap>(handlers: T, harness: Harness): T {
  const wrapped: McpHandlerMap = {};
  for (const [name, handler] of Object.entries(handlers)) {
    wrapped[name] = wrapMcpToolHandler(harness, name, handler);
  }
  return wrapped as T;
}

/**
 * Wrap an MCP client's `callTool(name, args)` for agent-side boundary testing.
 */
export function createMcpClientInterceptor(
  harness: Harness,
  callTool: (name: string, args: unknown) => Promise<unknown>,
): (name: string, args: unknown) => Promise<unknown> {
  return (name, args) =>
    harness.dispatch("tool", name, args, () => callTool(name, args));
}
