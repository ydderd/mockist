import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `test/jest/**` is run by Jest (it imports from `@jest/globals`); keep it out of Vitest.
    exclude: ["**/node_modules/**", "**/dist/**", "test/jest/**"],
  },
});
