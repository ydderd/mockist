import type { Harness } from "../core/harness";

/**
 * Structural type for a Vercel AI SDK tool. We avoid importing `ai`'s types so the
 * adapter stays version-tolerant: a tool is an object with an optional
 * `execute(input, options)`.
 */
type ToolLike = {
  execute?: (input: any, options: any) => unknown | Promise<unknown>;
  [key: string]: unknown;
};
type ToolSet = Record<string, ToolLike>;

/**
 * Wrap each tool's `execute` so calls route through the harness. Tools without an
 * `execute` (client-side / forwarded tools) are returned untouched.
 */
export function wrapVercelTools<T extends ToolSet>(tools: T, harness: Harness): T {
  const wrapped: ToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (typeof tool.execute !== "function") {
      wrapped[name] = tool;
      continue;
    }
    const originalExecute = tool.execute.bind(tool);
    wrapped[name] = {
      ...tool,
      execute: (input: unknown, options: unknown) =>
        harness.dispatch("tool", name, input, () => Promise.resolve(originalExecute(input, options))),
    };
  }
  return wrapped as T;
}
