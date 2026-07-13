# DevForge Testing Infrastructure Design Proposal

**Story:** STAB-004 — Shared Testing Foundation
**Status:** Proposal (awaiting Tech Lead review)
**Author:** Senior Software Engineer, DevForge Core

---

## 1. Executive Summary

This document proposes a unified testing infrastructure for the DevForge monorepo using **Vitest** as the test runner. The goal is to establish a shared, zero-config foundation that works across all workspace packages (shared libraries, apps, and internal tools) with fast startup, first-class TypeScript/ESM support, and seamless Turborepo integration.

---

## 2. Why Vitest?

### Selection Criteria Met

| Requirement | Vitest Support |
|-------------|----------------|
| **Shared packages** | Workspace-aware, runs tests per-package or globally |
| **Fast startup** | ~50ms cold start (Vite dev server reuse), parallel execution |
| **TypeScript** | Native TS/ESM via `vite-node` / `tsx` — no transpilation step |
| **ESM** | First-class ESM support, `import.meta.vitest`, top-level await |
| **Workspace execution** | `vitest run` respects `pnpm` workspaces; filters via `--workspace` |

### Key Advantages for DevForge

1. **Vite ecosystem alignment** — Web app (`apps/web`) already uses Vite; shared config reduces cognitive load
2. **TypeScript-native** — No `ts-jest` complexity; types flow through test files automatically
3. **Watch mode** — `vitest watch` integrates with `turbo run dev` for TDD loops
4. **Snapshot testing** — Built-in, compatible with Jest snapshots
5. **Coverage** — `v8` provider (native, fast), Istanbul-compatible reports
6. **Mocking** — `vi.fn()`, `vi.mock()` with ESM hoisting handled correctly
7. **Test UI** -- `vitest --ui` for visual debugging

### Alternatives Considered

| Framework | Rejection Reason |
|-----------|------------------|
| **Jest** | Requires `ts-jest`/`babel` for TS/ESM; slow cold start; ESM support still experimental; separate config per package |
| **Node `--test`** | No TypeScript native support (requires `tsx`); no snapshot/mocking built-ins; no watch mode UI; limited workspace awareness |
| **Mocha** | Requires heavy config for TS/ESM; no parallel execution by default; no built-in mocking |
| **Playwright** | Overkill for unit/integration; designed for e2e; slower startup |

---

## 3. Proposed Folder Structure

```
devforge/
├── package.json                    # Root scripts: test, test:ci, test:watch
├── vitest.config.ts                # Root config (extends per-package)
├── vitest.workspace.ts             # Vitest workspace definition
├── pnpm-workspace.yaml
├── turbo.json                      # Updated with test tasks
├── packages/
│   ├── repository-indexer/
│   │   ├── package.json            # Adds "test": "vitest run"
│   │   ├── vitest.config.ts        # Package-specific overrides (optional)
│   │   └── src/
│   │       └── __tests__/          # Co-located tests (or tests/ at root)
│   ├── parser-typescript/
│   ├── logger/
│   ├── symbol-graph/
│   ├── config/
│   └── ... (all shared packages)
├── apps/
│   ├── api/
│   │   ├── package.json
│   │   └── vitest.config.ts
│   └── web/
│       ├── package.json
│       └── vitest.config.ts
```

### Test File Conventions

- **Location**: `src/__tests__/*.test.ts` (co-located with source)
- **Naming**: `*.test.ts` for unit/integration; `*.spec.ts` for behavior-driven
- **Type tests**: `*.test-d.ts` (using `vitest-typecheck` or `tsd`)

---

## 4. Required Package Changes

### 4.1 Root `package.json`

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:ci": "vitest run --coverage",
    "test:update": "vitest run -u"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "happy-dom": "^14.0.0"
  }
}
```

### 4.2 Per-Package `package.json` (template)

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "vitest": "workspace:*",
    "@vitest/coverage-v8": "workspace:*",
    "happy-dom": "workspace:*"
  }
}
```

> **Note**: Use `workspace:*` for Vitest deps to ensure single version across monorepo.

### 4.3 `@repo/typescript-config` Extension

Add `vitest/globals` to `compilerOptions.types` in shared tsconfig base:

```json
{
  "compilerOptions": {
    "types": ["vitest/globals", "node"]
  }
}
```

Enables global `describe`, `it`, `expect`, `vi` without imports.

---

## 5. Root Scripts (Turborepo Integration)

### `turbo.json` Additions

```json
{
  "tasks": {
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"],
      "cache": true
    },
    "test:watch": {
      "cache": false,
      "persistent": true
    },
    "test:ci": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**", "test-results/**"],
      "cache": true
    }
  }
}
```

### Execution Patterns

```bash
# Run all tests (cached)
pnpm test

# Watch mode for active development
pnpm test:watch

# CI pipeline (with coverage)
pnpm test:ci

# Single package
pnpm --filter @devforge/repository-indexer test

# Single test file
pnpm --filter @devforge/repository-indexer test src/__tests__/scanner.test.ts

# Update snapshots
pnpm test:update
```

---

## 6. Shared Configuration

### 6.1 `vitest.config.ts` (Root)

```ts
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
```

### 6.2 `vitest.workspace.ts` (Workspace Definition)

```ts
/// <reference types="vitest" />
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  // All packages with package.json
  "packages/*",
  "apps/*",

  // Or explicit list for control:
  // "packages/repository-indexer",
  // "packages/parser-typescript",
  // "packages/logger",
  // "apps/api",
  // "apps/web",
]);
```

### 6.3 `vitest.setup.ts` (Optional Global Setup)

```ts
import { beforeAll, afterAll, vi } from "vitest";

// Global test utilities, mocks, env setup
beforeAll(() => {
  vi.useFakeTimers(); // if needed globally
});

afterAll(() => {
  vi.useRealTimers();
});

// Custom matchers
declare module "vitest" {
  interface Assertion {
    toBeRepositoryTree(): this;
  }
}
```

### 6.4 Per-Package Override (Optional)

```ts
// packages/repository-indexer/vitest.config.ts
import { defineConfig } from "vitest/config";
import rootConfig from "../../../vitest.config";

export default defineConfig({
  test: {
    // Extend root, override only what's needed
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

---

## 7. Example Test (Repository Indexer)

### `packages/repository-indexer/src/__tests__/scanner.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { scanRepository, RepositoryScanError } from "../index.js";
import type { RepositoryTree, FileNode, DirectoryNode } from "../index.js";

describe("scanRepository", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "df-indexer-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const createFixture = async (structure: Record<string, string | Record<string, unknown>>, base = tempRoot) => {
    for (const [name, content] of Object.entries(structure)) {
      const path = join(base, name);
      if (typeof content === "string") {
        await writeFile(path, content);
      } else {
        await mkdir(path, { recursive: true });
        await createFixture(content, path);
      }
    }
  };

  describe("basic traversal", () => {
    it("returns root directory with empty children for empty dir", async () => {
      const tree = await scanRepository(tempRoot);

      expect(tree.root.type).toBe("directory");
      expect(tree.root.children).toHaveLength(0);
      expect(tree.totalNodes).toBe(1);
    });

    it("recursively builds nested directories with lexicographic ordering", async () => {
      await createFixture({
        "dir2": { "file-b.txt": "b" },
        "dir1": { "file-a.txt": "a", "subdir": { "nested.txt": "n" } },
        "root-file.txt": "root",
      });

      const tree = await scanRepository(tempRoot);

      const rootChildren = tree.root.children.map((n) => n.name);
      expect(rootChildren).toEqual(["dir1", "dir2", "root-file.txt"]);

      const dir1 = tree.root.children.find((n) => n.name === "dir1") as DirectoryNode;
      expect(dir1.children.map((n) => n.name)).toEqual(["file-a.txt", "subdir"]);
    });

    it("represents mixed files and folders correctly", async () => {
      await createFixture({
        "src": { "index.ts": "export {}", "lib": { "util.ts": "export {}" } },
        "tests": { "test.ts": "test" },
        "README.md": "# Readme",
        "package.json": "{}",
      });

      const tree = await scanRepository(tempRoot);

      expect(tree.root.children).toHaveLength(4);
      const src = tree.root.children.find((n) => n.name === "src") as DirectoryNode;
      expect(src.children).toHaveLength(2);
      expect(src.children[0].type).toBe("file");
      expect(src.children[1].type).toBe("directory");
    });
  });

  describe("error handling", () => {
    it("throws NOT_FOUND for non-existent path", async () => {
      await expect(scanRepository("/absolutely/nonexistent/path/xyz"))
        .rejects.toThrow(RepositoryScanError);
      await expect(scanRepository("/absolutely/nonexistent/path/xyz"))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws NOT_A_DIRECTORY when root is a file", async () => {
      const file = join(tempRoot, "file.txt");
      await writeFile(file, "content");

      await expect(scanRepository(file))
        .rejects.toMatchObject({ code: "NOT_A_DIRECTORY" });
    });

    it("throws INVALID_ROOT when root is a symlink", async () => {
      const target = join(tempRoot, "real-dir");
      await mkdir(target);
      const link = join(tempRoot, "link-dir");
      await symlink(target, link, "dir");

      await expect(scanRepository(link))
        .rejects.toMatchObject({ code: "INVALID_ROOT" });
    });
  });

  describe("symlink handling inside tree", () => {
    it("skips broken symlinks", async () => {
      await createFixture({
        "target-dir": { "real.txt": "content" },
      });
      await symlink("/nonexistent/target", join(tempRoot, "broken-link"));

      const tree = await scanRepository(tempRoot);

      const names = tree.root.children.map((n) => n.name);
      expect(names).not.toContain("broken-link");
      expect(names).toContain("target-dir");
    });

    it("skips symlinks to files", async () => {
      await createFixture({
        "real.txt": "content",
      });
      await symlink(join(tempRoot, "real.txt"), join(tempRoot, "link-to-file.txt"));

      const tree = await scanRepository(tempRoot);

      expect(tree.root.children.map((n) => n.name)).toEqual(["link-to-file.txt", "real.txt"]);
      // symlink skipped, only real file remains
      expect(tree.root.children).toHaveLength(1);
    });

    it("skips symlinks to directories", async () => {
      await createFixture({
        "real-dir": { "nested.txt": "content" },
      });
      await symlink(join(tempRoot, "real-dir"), join(tempRoot, "link-to-dir"), "dir");

      const tree = await scanRepository(tempRoot);

      // Only real-dir should appear, not the symlink
      expect(tree.root.children).toHaveLength(1);
      expect(tree.root.children[0].name).toBe("real-dir");
    });
  });

  describe("file extensions", () => {
    beforeEach(async () => {
      await createFixture({
        "noextension": "data",
        "simple.txt": "data",
        "multi.part.ts": "data",
        ".env": "SECRET=1",
        ".gitignore": "node_modules",
        "README.md": "# Readme",
      });
    });

    it("file without extension has empty string extension", async () => {
      const tree = await scanRepository(tempRoot);
      const file = tree.root.children.find((n) => n.name === "noextension") as FileNode;
      expect(file.extension).toBe("");
    });

    it("file with simple extension", async () => {
      const tree = await scanRepository(tempRoot);
      const file = tree.root.children.find((n) => n.name === "simple.txt") as FileNode;
      expect(file.extension).toBe("txt");
    });

    it("file with multiple dots uses last segment", async () => {
      const tree = await scanRepository(tempRoot);
      const file = tree.root.children.find((n) => n.name === "multi.part.ts") as FileNode;
      expect(file.extension).toBe("ts");
    });

    it("dotfile (.env) has empty extension", async () => {
      const tree = await scanRepository(tempRoot);
      const file = tree.root.children.find((n) => n.name === ".env") as FileNode;
      expect(file.extension).toBe("");
    });

    it("dotfile (.gitignore) has empty extension", async () => {
      const tree = await scanRepository(tempRoot);
      const file = tree.root.children.find((n) => n.name === ".gitignore") as FileNode;
      expect(file.extension).toBe("");
    });
  });

  describe("large directory performance", () => {
    it("traverses 500 files successfully", async () => {
      const files = Object.fromEntries(
        Array.from({ length: 500 }, (_, i) => [`file${i.toString().padStart(4, "0")}.txt`, `content ${i}`])
      );
      await createFixture(files);

      const tree = await scanRepository(tempRoot);

      expect(tree.root.children).toHaveLength(500);
      expect(tree.totalNodes).toBe(501); // root + 500 files
    });
  });

  describe("deterministic ordering", () => {
    it("sorts children lexicographically case-sensitive", async () => {
      await createFixture({
        "a.txt": "a",
        "B.txt": "B",
        "a1.txt": "a1",
        "aa.txt": "aa",
        "Ab.txt": "Ab",
      });

      const tree = await scanRepository(tempRoot);
      const names = tree.root.children.map((n) => n.name);

      // Case-sensitive: uppercase before lowercase
      expect(names).toEqual(["Ab.txt", "B.txt", "a.txt", "a1.txt", "aa.txt"]);
    });
  });

  describe("RepositoryTree metadata", () => {
    it("scannedAt is valid ISO timestamp", async () => {
      await writeFile(join(tempRoot, "file.txt"), "content");
      const tree = await scanRepository(tempRoot);

      const date = new Date(tree.scannedAt);
      expect(date.toISOString()).toBe(tree.scannedAt);
      expect(date.getTime()).not.toBeNaN();
    });

    it("rootPath matches input exactly", async () => {
      const tree = await scanRepository(tempRoot);
      expect(tree.rootPath).toBe(tempRoot);
    });
  });
});
```

---

## 8. Example Package Integration

### 8.1 Repository Indexer (`packages/repository-indexer`)

**package.json** (additions):
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "vitest": "workspace:*",
    "@vitest/coverage-v8": "workspace:*",
    "happy-dom": "workspace:*"
  }
}
```

**vitest.config.ts** (optional override):
```ts
import { defineConfig } from "vitest/config";
import rootConfig from "../../../vitest.config";

export default defineConfig({
  test: {
    ...rootConfig.test,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

### 8.2 Parser TypeScript (`packages/parser-typescript`)

Uses same pattern; may need `environment: "happy-dom"` if testing browser-adjacent code.

### 8.3 API App (`apps/api`)

```ts
// apps/api/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Mock Fastify, database, etc.
  },
});
```

### 8.4 Web App (`apps/web`)

```ts
// apps/web/vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
  },
});
```

---

## 9. Migration Strategy

### Phase 1: Foundation (This PR)
1. Add Vitest to root `devDependencies`
2. Create root `vitest.config.ts`, `vitest.workspace.ts`, `vitest.setup.ts`
3. Update `turbo.json` with test tasks
4. Add test scripts to root `package.json`

### Phase 2: Package Adoption (Incremental)
1. Add test script + Vitest devDep to each package (`pnpm add -D -w vitest @vitest/coverage-v8 happy-dom`)
2. Create `src/__tests__/` with at least one test per package
3. Run `pnpm test` to verify

### Phase 3: CI Integration
1. Add `test:ci` to GitHub Actions / CI pipeline
2. Configure coverage thresholds
3. Add badge to README

### Phase 4: Advanced Features (Future)
- Type testing with `vitest-typecheck` / `tsd`
- Contract testing with `@pact-foundation/pact`
- Visual regression (Storybook + Vitest)
- Mutation testing (`stryker`)

---

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Vitest version drift** | Medium | Low | Pin via `workspace:*` in all packages; single version in root |
| **ESM/CommonJS interop issues** | Low | Medium | Use `type: "module"` everywhere; `vitest` handles ESM natively |
| **Slow CI on large monorepo** | Medium | Medium | Turborepo caching; `--changed` filter; sharding via `vitest --pool=forks` |
| **TypeScript config conflicts** | Low | Medium | Shared `@repo/typescript-config` with `vitest/globals` in types |
| **Team unfamiliarity** | Medium | Low | Vitest API mirrors Jest; docs + example tests in each package |

---

## 11. Future Scaling Considerations

1. **Sharding** — `vitest --shard=1/4` for CI parallelization
2. **Test categorization** — `@vitest/tags` for unit/integration/e2e separation
3. **Flaky test detection** -- `vitest --retry=3` with `--reporter=json`
4. **Snapshot management** — `--update` flag; review in PR
5. **Performance budgets** — `testTimeout` per-suite; `benchmark` mode
6. **Monorepo test graph** — `turbo run test --filter=...[HEAD]` for affected packages only

---

## 12. Decision Requested

**Approve this design** to proceed with implementation (Phase 1).

Upon approval, I will:
1. Add Vitest dependencies to root
2. Create shared config files
3. Update `turbo.json` and root `package.json`
4. Add test script to `repository-indexer` as pilot package
5. Write initial test suite for `scanRepository` (as shown in Section 7)
6. Verify `pnpm test` passes end-to-end

---

*End of Proposal*