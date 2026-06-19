# OpenAI example

## Pattern A: tools with `execute`

Same mental model as Vercel AI SDK — wrap the registry once:

```ts
const tools = wrapOpenAiTools(myToolRegistry, harness);
await tools.get_weather.execute({ city: "Paris" });
```

## Pattern B: manual tool loop

When the API returns `tool_calls` and you dispatch yourself:

```ts
const dispatch = createOpenAiToolInterceptor(harness, runTool);

for (const call of response.output) {
  if (call.type !== "function_call") continue;
  const args = JSON.parse(call.arguments);
  const result = await dispatch(call.name, args);
  // feed result back to the model...
}
```

## Files

| File | Purpose |
|------|---------|
| [`integration.ts`](./integration.ts) | Registry, `wireOpenAiTools`, `wireOpenAiToolLoop` |
| [`wrap-tools.test.ts`](./wrap-tools.test.ts) | Both patterns + sequential stubs |

## Run

```bash
npx vitest run examples/openai
```
