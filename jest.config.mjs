/**
 * Jest is a *second* runner alongside Vitest. mockist's core is runner-agnostic; this
 * config proves the public API and the `mockist/jest-setup` auto-save hook work under
 * Jest's ESM + TypeScript path. Vitest still owns the full suite (see vitest.config.ts).
 */
export default {
  preset: "ts-jest/presets/default-esm",
  extensionsToTreatAsEsm: [".ts"],
  testEnvironment: "node",
  roots: ["<rootDir>/test/jest"],
  // Run the same setup module consumers register via `setupFilesAfterEnv: ["mockist/jest-setup"]`.
  setupFilesAfterEnv: ["<rootDir>/src/setup/jest.ts"],
  // Source uses extensionless (Bundler-style) imports; allow optional `.js` specifiers too.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: "tsconfig.jest.json" }],
  },
};
