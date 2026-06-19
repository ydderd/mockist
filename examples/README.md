# mockist examples

**Start here:** each SDK has an `integration.ts` with commented, copy-pasteable
wiring code. Tests only verify that file — read `integration.ts` first.

| SDK | Integration code | Walkthrough |
|-----|------------------|-------------|
| Vercel AI SDK | [`vercel-ai/integration.ts`](./vercel-ai/integration.ts) | [`vercel-ai/README.md`](./vercel-ai/README.md) |
| Claude Agent SDK | [`claude-agent-sdk/integration.ts`](./claude-agent-sdk/integration.ts) | [`claude-agent-sdk/README.md`](./claude-agent-sdk/README.md) |
| MCP | [`mcp/integration.ts`](./mcp/integration.ts) | [`mcp/README.md`](./mcp/README.md) |
| OpenAI | [`openai/integration.ts`](./openai/integration.ts) | [`openai/README.md`](./openai/README.md) |
| Schema stubs | [`schema-grounded/integration.ts`](./schema-grounded/integration.ts) | [`schema-grounded/README.md`](./schema-grounded/README.md) |
| Vitest matchers | [`vitest-matchers/integration.ts`](./vitest-matchers/integration.ts) | [`vitest-matchers/README.md`](./vitest-matchers/README.md) |

## Layout

```
examples/
  <sdk>/
    README.md         ← call flow, hook shapes, minimal snippet
    integration.ts    ← **the code to copy** (heavily commented)
    *.test.ts         ← CI checks integration.ts (thin)
  shared/
    claude-hook-sim.ts  ← simulate Claude hooks without API key
```

## Import path

`integration.ts` files import from `../../src/index` while developing in the
mockist repo. In your app:

```ts
import { createHarness, wrapVercelTools } from "mockist";
```

## Universal pattern

```ts
// 1. Declare boundary stubs
const harness = createHarness({ stubs: [...], onUnhandled: "error" });

// 2. Wrap at your SDK's tool boundary (adapter-specific — see integration.ts)
const tools = wrapVercelTools(myTools, harness);           // Vercel
const hooks = createClaudeAgentHooks(harness);            // Claude
const handlers = wrapMcpHandlers(myHandlers, harness);    // MCP server
const tools = wrapOpenAiTools(myRegistry, harness);       // OpenAI

// 3. Run agent
await generateText({ model, tools, prompt });  // or query(), callTool(), etc.

// 4. Assert trajectory
expect(harness.trajectory).toMatchObject([...]);
// or: import "mockist/vitest-matchers"; expect(harness).toHaveCalledTool("x");
```

## Run

```bash
npm test                          # all examples + unit tests
npx vitest run examples/mcp       # one SDK
```
