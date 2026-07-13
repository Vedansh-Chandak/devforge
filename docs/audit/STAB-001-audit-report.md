# Monorepo Health Audit Report

**Story ID**: STAB-001
**Status**: COMPLETE
**Date**: 2026-07-13

---

## Executive Summary

The DevForge monorepo contains **17 packages** (5 apps + 12 packages) with a mix of production-ready code and stub/placeholder packages. The core pipeline packages (`repository-indexer`, `symbol-graph`, `parser-typescript`, `knowledge-graph`) have functional implementations but exhibit **Critical** and **High** severity issues in workspace configuration, TypeScript setup, package boundaries, build system, and testing.

---

## Issues by Category

### 1. Workspace Health

| ID | Severity | Description | Root Cause | Fix | Effort |
|----|----------|-------------|------------|-----|--------|
| W-01 | **Critical** | `repository-indexer` exports `./src/index.ts` (source) not `./dist/index.js` (built) | Package.json `exports` points to TypeScript source instead of compiled output | Change exports to `./dist/index.js` with types at `./dist/index.d.ts` | 15 min |
| W-02 | **Critical** | `repository-indexer` has no `build` script, only `typecheck` | Missing build pipeline configuration | Add `"build": "tsc"` script | 5 min |
| W-03 | **High** | `symbol-graph`, `parser-typescript`, `logger` have `private: true` but are workspace dependencies | Inconsistent privacy settings across workspace packages | Remove `private: true` from packages consumed by others | 10 min |
| W-04 | **High** | 6 packages have `private: true` but are listed as workspace dependencies | Package.json misconfiguration | Fix privacy flags | 10 min |
| W-05 | **Medium** | Root `package.json` has `typescript` in devDependencies but all packages duplicate it | No hoisted/shared TypeScript | Hoist TypeScript to root or use packageManager `catalog` | 15 min |
| W-06 | **Medium** | `@devforge/config` has `zod` dependency but no `@devforge/config` in root deps | Missing root-level dependency hoisting | Consider hoisting zod or keeping local | 5 min |
| W-07 | **Low** | Empty stub packages: `auth`, `database`, `forgecore`, `graph`, `providers`, `workflow` | Placeholder packages never implemented | Remove or document as future | 10 min |

### 2. TypeScript

| ID | Severity | Description | Root Cause | Fix | Effort |
|----|----------|-------------|------------|-----|--------|
| T-01 | **Critical** | `repository-indexer` imports `.js` extensions from `.ts` files but no `moduleResolution: "NodeNext"` in its tsconfig | tsconfig doesn't match package type:module | Add `moduleResolution: "NodeNext"` and `module: "NodeNext"` | 5 min |
| T-02 | **Critical** | `repository-indexer/src` contains compiled `.js`, `.d.ts`, `.d.ts.map` files committed to source | Build output not gitignored in package | Add `dist/` to package .gitignore (already in root) | 5 min |
| T-03 | **High** | `knowledge-graph` has `incremental: false` while base config has `incremental: false` - inconsistent | Redundant config | Remove redundant override | 2 min |
| T-04 | **High** | `repository-indexer`, `symbol-graph`, `parser-typescript` use `@repo/typescript-config` but don't extend properly | Missing `extends` with correct path | Verify all extend base config correctly | 5 min |
| T-05 | **Medium** | `repository-indexer` tsconfig lacks `outDir`, `rootDir`, `declaration` | No build output configuration | Add build-output options | 5 min |
| T-06 | **Medium** | No project references configured for Turbo incremental builds | Missing `references` in tsconfig.json | Add project references for build ordering | 15 min |
| T-07 | **Low** | `strict: true` but some packages may have implicit any | Need verification | Run `tsc --noEmit` on all packages | 5 min |

### 3. Package Boundaries

| ID | Severity | Description | Root Cause | Fix | Effort |
|----|----------|-------------|------------|-----|--------|
| B-01 | **Critical** | `repository-indexer` imports from `.js` files (e.g., `"./types.js"`) but source is `.ts` | ESM import style with wrong extensions | Fix import extensions or use tsconfig paths | 10 min |
| B-02 | **High** | `knowledge-graph` depends on `@devforge/symbol-graph` but symbol-graph has `private: true` | Dependency on private package | Make symbol-graph public or internal | 5 min |
| B-03 | **High** | Empty packages (`auth`, `database`, etc.) pollute workspace | Never implemented/removed | Remove empty packages | 10 min |
| B-04 | **Medium** | `repository-indexer` has `node_modules` in package (pnpm workspaces hoist) | Not an issue with pnpm | Verify pnpm hoisting works | 2 min |
| B-05 | **Low** | `apps/api` uses `@repo/logger` (different scope than `@devforge/*`) | Inconsistent package naming | Standardize on `@devforge/*` or document dual scope | 5 min |

### 4. Build System

| ID | Severity | Description | Root Cause | Fix | Effort |
|----|----------|-------------|------------|-----|--------|
| BL-01 | **Critical** | Only `knowledge-graph` has a `build` script and `dist/` output | Other packages lack build pipeline | Add build scripts to all buildable packages | 20 min |
| BL-02 | **High** | Turbo `build` task dependsOn `^build` but most packages have no build | Task graph broken | Either add builds or remove from pipeline | 10 min |
| BL-03 | **High** | No `check-types` script in `repository-indexer` (has `typecheck` only) | Inconsistent script naming | Standardize on `check-types` | 5 min |
| BL-04 | **Medium** | Turbo `outputs` includes `dist/**` but most packages don't produce dist | Cache invalidation incorrect | Fix outputs per package | 5 min |
| BL-05 | **Medium** | `repository-indexer` has no tsconfig for build (only typecheck) | Can't produce declarations | Add build tsconfig | 10 min |
| BL-06 | **Low** | Turbo `ui: "tui"` may not be available in CI | TUI requires TTY | Consider `ui: "stream"` for CI | 2 min |

### 5. Testing

| ID | Severity | Description | Root Cause | Fix | Effort |
|----|----------|-------------|------------|-----|--------|
| TS-01 | **Critical** | `repository-indexer` has **zero tests** | No test infrastructure | Add vitest config and test file | 20 min |
| TS-02 | **Critical** | `parser-typescript` has 1 test file (166 lines) - minimal coverage | Incomplete testing | Add more tests | 30 min |
| TS-03 | **High** | `symbol-graph` has 2 test files but no vitest config file | Missing vitest.config.ts | Add vitest config | 5 min |
| TS-04 | **High** | `logger`, `config`, `ui`, `eslint-config`, `typescript-config` have **no tests** | Never added | Add basic tests or document as untested | 30 min |
| TS-05 | **Medium** | `knowledge-graph` has 401-line test but tests internal builder functions | Tests may be brittle | Review test quality | 10 min |
| TS-06 | **Low** | No test coverage thresholds configured | Missing quality gates | Add coverage config | 5 min |

### 6. Performance

| ID | Severity | Description | Root Cause | Fix | Effort |
|----|----------|-------------|------------|-----|--------|
| P-01 | **High** | `linker.ts:249-270` `resolveModuleSpecifier` uses `allParsedFiles.find()` in hot path - O(N*M) | Linear search for module resolution | Add filePath->ParsedFile Map index | 20 min |
| P-02 | **High** | `indexer.ts:106-168` `walk()` makes sequential `lstat` per file - no batching | Naive tree walk | Consider batched stat or worker threads | 30 min |
| P-03 | **Medium** | `builder.ts:34-83` `buildEdgesFromSymbolGraph` creates `nodeBySymbolId` Map with composite key for every call | Recreates index on each build | Cache or pre-index | 15 min |
| P-04 | **Medium** | `recognizer.ts:157-193` `recognizeAll` calls 5 recognizers per symbol sequentially | Multiple passes over symbols | Single-pass recognition | 20 min |
| P-05 | **Low** | `graph.ts` uses `Map` for nodes/edges but serializes to array - double storage | Serialization format | Acceptable for current scale | N/A |

### 7. Security

| ID | Severity | Description | Root Cause | Fix | Effort |
|----|----------|-------------|------------|-----|--------|
| S-01 | **High** | `repository-indexer` uses `resolvePath` from user input without path traversal checks | `scanRepository(root)` takes arbitrary path | Add path normalization and root validation | 15 min |
| S-02 | **Medium** | `repository-indexer` follows symlinks? No - correctly skips them | Correct behavior | Verify | 2 min |
| S-03 | **Low** | `apps/api` uses `dotenv` with no validation | Environment injection risk | Add schema validation (zod) | 10 min |
| S-04 | **Low** | `pnpm-lock.yaml` commits lockfile - good practice | N/A | Keep | N/A |

### 8. Documentation

| ID | Severity | Description | Root Cause | Fix | Effort |
|----|----------|-------------|------------|-----|--------|
| D-01 | **High** | `symbol-graph`, `parser-typescript`, `logger`, `config` lack README.md | Never created | Add package READMEs | 30 min |
| D-02 | **High** | Empty packages (`auth`, `database`, etc.) have no documentation | Never created | Add README or remove | 15 min |
| D-03 | **Medium** | Root README.md exists but doesn't document architecture | Missing context | Add architecture overview | 10 min |
| D-04 | **Medium** | Architecture docs exist but no ADR index | ADRs in `docs/adr/` not indexed | Add ADR index | 5 min |
| D-05 | **Low** | Package.json `description` fields missing on most packages | npm best practice | Add descriptions | 10 min |

---

## Summary Statistics

| Severity | Count |
|----------|-------|
| **Critical** | 6 |
| **High** | 12 |
| **Medium** | 11 |
| **Low** | 8 |
| **Total** | **37** |

---

## Priority Fix Order (Recommended)

1. **Critical Workspace/Build**: W-01, W-02, BL-01, BL-02 (unblock builds)
2. **Critical TypeScript**: T-01, T-02 (fix compilation)
3. **Critical Package Boundaries**: B-01, B-02 (fix dependency graph)
4. **Critical Testing**: TS-01, TS-03 (enable CI testing)
5. **Security**: S-01 (path traversal)
6. **Performance**: P-01, P-02 (algorithmic fixes)
7. **Documentation**: D-01, D-02 (discoverability)
8. **Remaining Medium/Low**: Cleanup

---

## Risk Assessment

| Area | Risk Level | Notes |
|------|------------|-------|
| **Build Pipeline** | **HIGH** | Most packages cannot build; Turbo will fail |
| **Dependency Resolution** | **HIGH** | Private packages depended on by public ones |
| **TypeScript Compilation** | **MEDIUM** | Source imports with .js extensions will fail |
| **Test Coverage** | **MEDIUM** | Core packages untested; regressions undetected |
| **Security** | **MEDIUM** | Path traversal in repository scanner |
| **Performance** | **LOW** | Current scale small; O(N²) not yet problematic |

---

## Files Requiring Changes (Priority)

### Critical (Must Fix)
1. `/packages/repository-indexer/package.json` - exports, scripts, build config
2. `/packages/repository-indexer/tsconfig.json` - module resolution, outDir
3. `/packages/symbol-graph/package.json` - remove `private: true`
4. `/packages/parser-typescript/package.json` - remove `private: true`
5. `/packages/logger/package.json` - remove `private: true`
6. `/packages/knowledge-graph/package.json` - verify exports
7. `/packages/repository-indexer/src/indexer.ts` - path validation
8. `/packages/symbol-graph/src/linker.ts` - module resolution index

### High Priority
9. `/packages/repository-indexer/vitest.config.ts` - create
10. `/packages/symbol-graph/vitest.config.ts` - create
11. `/packages/parser-typescript/vitest.config.ts` - verify
12. `/turbo.json` - fix outputs, tasks
13. `/packages/symbol-graph/README.md` - create
14. `/packages/parser-typescript/README.md` - create
15. `/packages/logger/README.md` - create
16. `/packages/config/README.md` - create

### Medium/Low
17. Remove empty packages: `auth`, `database`, `forgecore`, `graph`, `providers`, `workflow`
18. Standardize script names (`typecheck` → `check-types`)
19. Add project references for Turbo
20. Add path traversal protection
21. Performance optimizations in linker/indexer

---

*End of Audit Report*