import type { Harness } from "../core/harness";

/**
 * Structural type for an OpenAI-style function tool with a local handler.
 * Mirrors the Vercel adapter: an object with an optional `execute(input)`.
 */
type OpenAiToolLike = {
  execute?: (input: unknown) => unknown | Promise<unknown>;
  [key: string]: unknown;
};
type OpenAiToolSet = Record<string, OpenAiToolLike>;

/**
 * Wrap each tool's `execute` so calls route through the harness. Tools without an
 * `execute` are returned untouched.
 */
export function wrapOpenAiTools<T extends OpenAiToolSet>(tools: T, harness: Harness): T {
  const wrapped: OpenAiToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (typeof tool.execute !== "function") {
      wrapped[name] = tool;
      continue;
    }
    const originalExecute = tool.execute.bind(tool);
    wrapped[name] = {
      ...tool,
      execute: (input: unknown) =>
        harness.dispatch("tool", name, input, () => Promise.resolve(originalExecute(input))),
    };
  }
  return wrapped as T;
}

/**
 * Wrap a standalone OpenAI tool runner callback (Responses API / manual dispatch).
 */
export function createOpenAiToolInterceptor(
  harness: Harness,
  runTool: (name: string, args: unknown) => Promise<unknown>,
): (name: string, args: unknown) => Promise<unknown> {
  return (name, args) => harness.dispatch("tool", name, args, () => runTool(name, args));
}
