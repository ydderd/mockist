# MCP example

## Server call flow

```
Client                          Your MCP server
  │  tools/call { name: "search", arguments: { q: "..." } }
  │ ─────────────────────────────────────────────────────────►
  │                                    handlers[name]({ arguments })
  │                                              │
  │                                    wrapMcpHandlers → harness.dispatch
  │                                              │
  │ ◄─────────────────────────────────────────────
  │  { content: [{ type: "text", text: "..." }] }
```

## Client call flow

```
Your agent code
  │
  │  callTool = createMcpClientInterceptor(harness, client.callTool)
  │  await callTool("mcp__memory__read", { key: "prefs" })
  │
  └─► harness.dispatch("tool", name, args, () => client.callTool(...))
```

## Files

| File | Purpose |
|------|---------|
| [`integration.ts`](./integration.ts) | `wireMcpServer`, `wireMcpClient`, handler factory |
| [`server-and-client.test.ts`](./server-and-client.test.ts) | Server + client scenarios |

## Run

```bash
npx vitest run examples/mcp
```
