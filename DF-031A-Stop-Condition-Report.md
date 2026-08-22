# DF-031A Stop-Condition Report

**Phase:** DF-031A — Fix the 9 failing CLI release/acceptance tests
**Date:** 2026-08-22
**Stop condition:** `apps/cli` test suite is green (158/158), `dist/` contains exactly the four intended self-contained artifacts, `npm pack` produces `devforge-cli-0.1.0.tgz` with only the published surface, root `check-types`/`build`/`test`/`lint` are green, and the public package identity is `@devforge/cli` (bin `devforge`). No publish, no commit, no tag.

## 1. Root causes of the 9 failures

### Group 1 — first-run-config tests time out (5 of the 9)
- `src/services/environment.ts` and `src/commands/doctor.ts` spawn `git --version`, `node --version`, and **`pnpm --version`** via `execSync` on every environment/health check, with a 10-second blocking timeout and **no memoization**.
- Each unit test builds its context through `makeCtx`, which calls `runEnvironmentChecks` → `pnpm --version`. Under the tests' isolated temp `HOME` (set by `beforeEach`) inside the vitest worker, `pnpm --version` hangs until the 10s `execSync` timeout. With multiple `makeCtx` calls per test, the 5s per-test vitest budget was exceeded → timeout failures. The provider/model path itself is offline and fast; the slowness was purely the repeated, never-cached subprocess probe.

### Group 2 — wrong tarball name (1 of the 9)
- `apps/cli/package.json` declared `"name": "@vedansh78/cli"`. `npm pack` therefore emitted `vedansh78-cli-0.1.0.tgz`, but the release tests (and the whole workspace convention) expect `@devforge/cli` → `devforge-cli-0.1.0.tgz`. All other `@devforge/*` packages use the `@devforge` scope and the tests `require('@devforge/cli')` / `import('@devforge/cli')` after install, so `@devforge/cli` is the intended public identity.

### Group 3 — duplicate `dist` artifacts (3 of the 9)
- `dist/` contained macOS "duplicate" files (`index 2.cjs`, `index 2.js`, `index.d 2.ts`, `main 2.js`) created outside the build (Finder/manual copy).
- `packaging.test.ts`/`release-readiness.test.ts` `beforeAll` only rebuilt `dist/` **conditionally** (`if (!existsSync(index.d.ts) || !existsSync(main.js))`). Because a stale (but present) `dist` already existed, the rebuild was skipped, so the duplicate files survived, got included by `npm pack` (via `files: ["dist"]`), and broke the "installed dist contains exactly `index.cjs/index.d.ts/index.js/main.js`" assertion.

## 2. Fixes applied (5 files)

1. **`apps/cli/package.json`** — `name` → `@devforge/cli` (bin `devforge` unchanged). Now matches workspace convention, the release docs, and the `pnpm --filter @devforge/cli` task commands.
2. **`src/services/environment.ts`** — `runCheck` results are now memoized process-wide and the `execSync` timeout is bounded (3s) so a pathological toolchain degrades to a "not found" check instead of hanging the inspection. Behavior of `doctor`/`config` is unchanged (checks still run; `pnpm`/`git`/`node` availability is still reported).
3. **`src/commands/doctor.ts`** — same memoized + bounded `runCheck` for the tool checks (`tsc`/`eslint`/test/build), so repeated `doctor` invocations do not re-probe.
4. **`__tests__/packaging.test.ts`** — `beforeAll` now **always** runs `scripts/build.mjs`. The build wipes `dist/` first, guaranteeing a deterministic, duplicate-free artifact set regardless of ambient state.
5. **`__tests__/release-readiness.test.ts`** — same `beforeAll` change (always rebuild).

Plus cleanup: removed the untracked macOS duplicate files (`* 2.*` / `* 3.*`) that had leaked into the working tree, including the stale `dist` duplicates and the wrong `vedansh78-cli-0.1.0.tgz`.

## 3. Verification (all green)

- `pnpm --filter @devforge/cli check-types` — pass.
- `pnpm --filter @devforge/cli build` — pass; `dist/` = `index.cjs`, `index.d.ts`, `index.js`, `main.js` (exactly 4).
- `pnpm --filter @devforge/cli test` — **158 passed / 158** (previously 149 passed + 9 failed).
- `pnpm check-types` — 26/26 tasks.
- `pnpm build` — 26/26 tasks.
- `pnpm test` — 46/46 tasks.
- `pnpm lint` — 3/3 tasks.
- `npm pack` — `devforge-cli-0.1.0.tgz`, 8 files (README, LICENSE, CHANGELOG, package.json, 4 dist artifacts); no `*.test.ts`, no `__tests__`, no `.env`, no secrets, no repo-relative paths.
- Isolated install (`npm install <tarball>` in a throwaway dir) resolves only real npm deps; `devforge --version`/`--help`/`doctor`/`config` work offline; ESM `import` and CJS `require` both resolve `validateConfig`/`createLightContext` etc.

## 4. Constraints honored

- No new model/provider; Brain/Planner/Executor/Autonomous/Multi-Agent architecture untouched.
- No tests disabled, skipped, weakened, or made less strict.
- No global test-timeout inflation; failures were fixed at the source (subprocess hangs / conditional rebuild / package identity).
- No hardcoded environment-specific paths; `dist` cleanup is produced by the existing `build.mjs` (`rmSync` + write).
- No publish, no commit, no git tag.
