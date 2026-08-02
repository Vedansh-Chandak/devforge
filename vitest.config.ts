/// <reference types="vitest" />
import { defineConfig, mergeConfig } from "vitest/config";
import { workspaceRoot } from "vitest/config";

export default defineConfig({
  test: {
    // Workspace root for relative paths
    root: workspaceRoot,

    // Global test settings
    globals: true,
    environment: "node", // or "happy-dom" for browser-like
    include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],

    // Parallelism
    pool: "threads",
    poolOptions: { threads: { singleThread: false } },
    maxConcurrency: 10,

    // Coverage (v8 provider)
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "lcov", "html"],
      reportsDirectory: "./coverage",
      include: ["packages/**/src/**", "apps/**/src/**"],
      exclude: ["**/*.test.ts", "**/*.d.ts", "**/__tests__/**"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },

    // TypeScript
    typecheck: {
      tsconfig: "./tsconfig.json",
    },

    // Reporters
    reporter: ["verbose", "json", "html"],
    outputFile: {
      json: "./test-results/results.json",
      html: "./test-results/index.html",
    },

    // Setup files (run once per test process)
    setupFiles: ["./vitest.setup.ts"],

    // Timeouts
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
