# toolest (working name)

Stub the tool calls your agent makes through the Vercel AI SDK. A stubbed call
returns a canned value (or throws); any other call runs the real tool. Every call
is recorded so you can assert what the agent did.

## Quick start

```ts
import { generateText } from "ai";
import { createHarness, wrapVercelTools } from "toolest";

const harness = createHarness({
  onUnhandled: "passthrough", // | "warn" | "error" (fail on any un-stubbed call)
  stubs: [
    { name: "get_weather", args: { city: "Paris" }, result: { tempC: 21 } }, // name + args
    { name: "search", match: (i) => i.q.includes("docs"), result: { hits: [] } }, // predicate
    { name: "flaky", result: () => { throw new Error("upstream 503"); } }, // failure
    { name: "now", result: "2026-06-07T00:00:00Z" }, // name only
  ],
});

const result = await generateText({
  model, // you supply this — a real model or the SDK's MockLanguageModelV3
  tools: wrapVercelTools(myTools, harness),
  prompt: "What's the weather in Paris?",
});

expect(harness.callsTo("get_weather")).toHaveLength(1);
expect(harness.trajectory[0]).toMatchObject({ name: "get_weather", stubbed: true });
```

## Matching

A stub matches when its `kind` (default `"tool"`) and `name` match the call, and:
its `match` predicate passes (if given), else its `args` deep-equal the input (if
given), else it matches the name regardless of input. First match wins. No match
runs the real `execute` (pass-through), unless `onUnhandled: "error"`.

## Assertions

`harness.trajectory` is a typed, read-only array of every call (`name`, `input`,
`output`/`error`, `stubbed`). Helpers: `harness.callsTo(name)`,
`harness.calledWith(name, input)`. Use your runner's own assertions. Call
`harness.reset()` between tests.

## Not yet (backlog)

Sequential stubs (`[error, then ok]`); recording real runs to generate stubs;
mocking dependencies inside a tool's `execute`; adapters for MCP / Anthropic /
OpenAI. See `docs/superpowers/specs/2026-06-06-declarative-tool-stub-harness-design.md`.
