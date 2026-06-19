/**
 * MCP integration with mockist
 * ==========================
 *
 * MCP has two integration points depending on where you test:
 *
 * A) MCP SERVER (you own the server)
 *    Wrap handlers before registering with tools/list + tools/call:
 *
 *      const handlers = wrapMcpHandlers({ search, ping }, harness);
 *      server.setRequestHandler(CallToolRequestSchema, async (req) => {
 *        const fn = handlers[req.params.name];
 *        return fn({ arguments: req.params.arguments });
 *      });
 *
 * B) MCP CLIENT (your agent calls a remote server)
 *    Wrap the client's callTool:
 *
 *      const callTool = createMcpClientInterceptor(harness, client.callTool.bind(client));
 *      await callTool("mcp__memory__read", { key: "prefs" });
 *
 * CALL SHAPE
 * ----------
 * Server handlers receive:  { arguments: <tool input object> }
 * Client interceptor receives: (name: string, args: unknown)
 *
 * Both route to: harness.dispatch("tool", name, input, original)
 */

import {
  createHarness,
  createMcpClientInterceptor,
  wrapMcpHandlers,
  wrapMcpToolHandler,
  defineStubs,
  type Harness,
  type McpHandlerMap,
} from "../../src/index";

// ---------------------------------------------------------------------------
// 1. Production MCP tool handlers (would live in your server)
// ---------------------------------------------------------------------------

export function createMcpToolHandlers(): McpHandlerMap {
  return {
    search: async ({ arguments: args }) => {
      const { q } = args as { q: string };
      // In production: query your search index
      return { content: [{ type: "text", text: `live:${q}` }] };
    },
    ping: async () => ({
      content: [{ type: "text", text: "pong" }],
    }),
    get_config: async () => ({
      content: [{ type: "text", text: JSON.stringify({ theme: "light" }) }],
    }),
  };
}

// ---------------------------------------------------------------------------
// 2. Harness stubs — MCP tool names match tools/list entries
// ---------------------------------------------------------------------------

export const MCP_SUITE_STUBS = defineStubs([
  {
    name: "search",
    args: { q: "mockist" },
    result: { content: [{ type: "text", text: "hit-1" }] },
  },
  {
    name: "mcp__memory__read",
    result: { entries: [] },
  },
  {
    name: "get_config",
    result: { content: [{ type: "text", text: '{"theme":"dark"}' }] },
  },
]);

export function createMcpHarness(overrides?: Parameters<typeof createHarness>[0]) {
  return createHarness({ stubs: [...MCP_SUITE_STUBS], onUnhandled: "passthrough", ...overrides });
}

// ---------------------------------------------------------------------------
// 3A. Server-side wiring
// ---------------------------------------------------------------------------

/**
 * Wrap all handlers at once — use when you dispatch tools/call by name.
 *
 * ```ts
 * const { handlers, harness } = wireMcpServer();
 * // In your CallTool handler:
 * const result = await handlers[params.name]({ arguments: params.arguments });
 * ```
 */
export function wireMcpServer(harness?: Harness) {
  const h = harness ?? createMcpHarness();
  const real = createMcpToolHandlers();
  const handlers = wrapMcpHandlers(real, h);
  return { handlers, harness: h, realHandlers: real };
}

/**
 * Wrap a single handler — use when tools are registered one at a time.
 */
export function wireSingleMcpTool(
  harness: Harness,
  name: string,
  handler: McpHandlerMap[string],
) {
  return wrapMcpToolHandler(harness, name, handler);
}

// ---------------------------------------------------------------------------
// 3B. Client-side wiring (agent calls remote MCP server)
// ---------------------------------------------------------------------------

export type RemoteCallTool = (name: string, args: unknown) => Promise<unknown>;

/**
 * ```ts
 * const client = await createMcpClient({ ... });
 * const callTool = wireMcpClient(harness, (name, args) => client.callTool({ name, arguments: args }));
 * await callTool("mcp__memory__read", { key: "user-1" });
 * ```
 */
export function wireMcpClient(harness: Harness, remoteCallTool: RemoteCallTool) {
  return createMcpClientInterceptor(harness, remoteCallTool);
}

// ---------------------------------------------------------------------------
// 4. Simulated tools/call dispatch (mirrors MCP server routing)
// ---------------------------------------------------------------------------

export async function dispatchMcpToolCall(
  handlers: McpHandlerMap,
  name: string,
  args: unknown,
) {
  const handler = handlers[name];
  if (!handler) throw new Error(`Unknown MCP tool: ${name}`);
  return handler({ arguments: args });
}
