import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/setup/vitest.ts", "src/setup/jest.ts", "src/cli.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // ai/zod are peerDeps — never bundle them in.
  external: ["ai", "zod", "vitest", "@jest/globals"],
});
