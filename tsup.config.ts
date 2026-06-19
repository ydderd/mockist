import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/setup/vitest.ts",
    "src/setup/jest.ts",
    "src/matchers/vitest.ts",
    "src/matchers/jest.ts",
    "src/cli.ts",
  ],
  // Dual ESM + CJS: Vitest consumers resolve ESM, Jest (default CommonJS) resolves CJS.
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // ai/zod are peerDeps — never bundle them in.
  external: ["ai", "zod", "vitest", "@jest/globals"],
});
