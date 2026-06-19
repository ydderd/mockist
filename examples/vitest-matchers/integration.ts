/**
 * Vitest matchers integration
 * ===========================
 *
 * The runner-agnostic assertion core lives in mockist itself. Matchers are
 * optional sugar for Vitest/Jest.
 *
 * SETUP (once per test file or in vitest.config.ts setupFiles)
 * ------------------------------------------------------------
 * ```ts
 * // vitest.config.ts
 * export default defineConfig({
 *   test: { setupFiles: ["mockist/vitest-matchers"] },
 * });
 * ```
 *
 * Or per file:
 * ```ts
 * import "mockist/vitest-matchers";
 * ```
 *
 * USAGE
 * -----
 * ```ts
 * const harness = createHarness({ stubs: [...] });
 * // ... run agent ...
 * expect(harness).toHaveCalledTool("get_weather");
 * expect(harness).toHaveCalledWith("search", { q: "billing" });
 * expect(harness).toHaveToolTrajectory([{ name: "a" }, { name: "b" }]);
 * expect(harness).toHaveNoPassthroughToolCalls();
 * expect(harness).toHaveFullyUsedCassette();  // when using cassettes
 * ```
 *
 * Matchers accept the harness as `received` — no global state required.
 */

import "../../src/matchers/vitest";
import { createHarness, wrapVercelTools, defineStubs, type Harness } from "../../src/index";

export const MATCHER_DEMO_STUBS = defineStubs([
  { name: "context_recall", result: { ok: true } },
  { name: "search", result: { hits: [] } },
]);

export function createMatcherDemoHarness() {
  return createHarness({ stubs: [...MATCHER_DEMO_STUBS] });
}

/** Run a two-tool trajectory suitable for matcher demos. */
export async function runMatcherDemoAgent(harness: Harness) {
  const tools = wrapVercelTools(
    {
      context_recall: {
        description: "Load session context",
        execute: async () => ({ ok: false }),
      },
      search: {
        description: "Search docs",
        execute: async () => ({ hits: ["would-hit-db"] }),
      },
    },
    harness,
  );

  await tools.context_recall.execute!({});
  await tools.search.execute!({ q: "docs" });
  return harness;
}
