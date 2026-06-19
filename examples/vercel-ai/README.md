# Vercel AI SDK example

## Call flow

```
generateText({ tools: wrapVercelTools(myTools, harness), ... })
        │
        ▼
  model returns tool-call { toolName: "get_weather", input: { city: "Paris" } }
        │
        ▼
  SDK invokes wrapped get_weather.execute({ city: "Paris" })
        │
        ▼
  harness.dispatch("tool", "get_weather", input, originalExecute)
        │
        ├─ stub match  → return canned result, record { stubbed: true }
        └─ no match    → run originalExecute(), record { stubbed: false }
```

## Files

| File | Purpose |
|------|---------|
| [`integration.ts`](./integration.ts) | **Copy from here** — tool factory, harness, wiring, agent runner |
| [`stub-trajectory.test.ts`](./stub-trajectory.test.ts) | CI test that exercises `integration.ts` |

## Minimal copy-paste

```ts
import { generateText } from "ai";
import { createHarness, wrapVercelTools } from "mockist";

const harness = createHarness({
  stubs: [{ name: "get_weather", args: { city: "Paris" }, result: { tempC: 21 } }],
  onUnhandled: "error",
});

const tools = wrapVercelTools(myTools, harness);

await generateText({ model, tools, prompt: "Weather in Paris?" });

expect(harness.trajectory[0]).toMatchObject({
  name: "get_weather",
  input: { city: "Paris" },
  stubbed: true,
});
```

## Run

```bash
npx vitest run examples/vercel-ai
```
