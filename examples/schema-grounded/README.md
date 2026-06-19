# Schema-grounded stubs

Catch fixture drift before the agent runs.

```ts
const stubs = stubsFromSchemas([
  { name: "get_weather", outputSchema: { type: "object", properties: { tempC: { type: "number" } } } },
]);

validateStubsAgainstSchemas(stubs, toolCatalog); // throws if result doesn't match schema
```

## Files

| File | Purpose |
|------|---------|
| [`integration.ts`](./integration.ts) | Catalog, generation, validation helpers |
| [`stubs.test.ts`](./stubs.test.ts) | CI tests |

## Run

```bash
npx vitest run examples/schema-grounded
```
