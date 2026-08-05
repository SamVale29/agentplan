import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      exclude: ["**/dist/**", "**/index.ts"]
    }
  }
});
