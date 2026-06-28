# Vitest matchers

Register once, assert on `harness` directly.

## Setup

```ts
// vitest.config.ts
export default defineConfig({
  test: { setupFiles: ["@ydderd/mockist/vitest-matchers"] },
});
```

Jest equivalent: add `@ydderd/mockist/jest-matchers` to `setupFilesAfterEnv` in `jest.config.js`.
See `test/jest-matchers.test.ts` for a smoke test.

## Matchers

| Matcher | Asserts |
|---------|---------|
| `toHaveCalledTool(name)` | At least one call to `name` |
| `toHaveCalledWith(name, partialInput)` | Deep-subset match on input |
| `toHaveToolTrajectory(expected[])` | Exact ordered trajectory |
| `toHaveToolSubsequence(expected[])` | Ordered subsequence (gaps OK) |
| `toHaveNoUnhandledToolCalls()` | Every call was stubbed |
| `toHaveNoPassthroughToolCalls()` | Alias for no real execute |
| `toHaveNoExhaustedStubSequences()` | No sequence stub ran dry |
| `toHaveFullyUsedCassette()` | Cassette replay fully consumed |

## Files

| File | Purpose |
|------|---------|
| [`integration.ts`](./integration.ts) | Demo harness + agent runner |
| [`matchers.test.ts`](./matchers.test.ts) | Matcher assertions |

## Run

```bash
npx vitest run examples/vitest-matchers
```
