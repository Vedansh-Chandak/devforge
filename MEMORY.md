# MEMORY.md

## Projects

### DevForge (`/Users/vedanshchandak/Desktop/devforge`)
- pnpm + turbo workspace. Packages under `packages/*`, apps under `apps/*`, extensions under `extensions/*`.
- Verification order for framework changes: package `pnpm check-types / build / test`, then root `pnpm check-types`, `pnpm build`, `pnpm test`.

### DF-024 — `@devforge/benchmark` (completed 2026-08-17)
Deterministic, fully-offline benchmark/evaluation framework; no real LLMs, scripts provide baselines. 490 tests / 27 suites green, package + root verify all pass.
- Design: injected `Clock`, `Environment`, `FileSystemIO`, `CommandRunner`; seeded `mulberry32` PRNG; content-hash result IDs; immutable stores; id-ascending tie-breaks; JSON-artifact + checksummed result persistence.
- Built-in 10-task `BASIC_DATASET` on `sample-ts` (9 categories, versions, all 4 verification kinds).
- Redaction via `@devforge/memory` `redactSecrets`; `"[REDACTED]"`; high-entropy heuristic ON by default — tests must avoid secret-shaped strings.
- CLI: `bin/benchmark.js` calls `main(argv)`; flags `--dataset/--baseline/--baseline-fail/--ab/--compare/--output/--threshold-success`; baselines: `pass`, `fail`, `scripted-rewrite`.
- Lessons: composite graders must thread an `active` verification branch (`verificationOf(context)`); fixture IO must list/cleanup recursively; when a suite test fails, check whether the helper's defaults (not the source) caused it; floats in deltas need rounding; AB via `compareRuns(a,b)` is directional (a→b).

### DF-025 — error/redaction/cancellation hardening (in progress, most phases done)
Plan lives in `DF-025-AUDIT.md` (prioritized list at bottom). Deferred non-goals are documented in the audit (globalThis IPC, `RuntimeConfig.config.*` not forwarded, `config/env.ts` eager parse, `review.ts` dead code, `doctor.ts` duplication).
- **Core architecture**: `@devforge/errors` (dependency-free `toEnvelope`/`ErrorEnvelope`/`redactSecretText`, lifecycle events; `isCancellationError`/`isTimeoutError` check `.code` AND class name via `classNameOf`). `packages/config/src/runtime-config.ts` precedence explicit > env > file > default; `redactSecrets` shared by config/logger/CLI.
- **Cancellation (signal plumbing)**: `ModelRequest.signal` on model-provider; OpenAI + Fake helper honor it (external abort → `CANCELLED` retryable:false; internal timeout → `TIMEOUT`). Planner `PlanOptions.signal` + `raceWithAbort` (returns CANCELLED result). Brain `AskOptions.signal`; ReasoningLoop now surfaces aborted signal as `provider_error` with `code:CANCELLED` instead of swallowing into tool_executed (fixed 2026-08-17). CLI SIGINT→AbortController; `resolveExitCode` (ConfigError 2, DiscoveryError 3, PlannerError 4, ExecutorError 5, else 1); second SIGINT force-exits 2.
- **Memory fix**: `RepositoryMemory` auto-save chain recovers after a failed flush (records `lastSaveError`, `flush()` rethrows, `dispose()` stops).
- **Deterministic hardening suites (2026-08-17)**: `packages/integration-tests/src/hardening.test.ts` (17 tests — envelope failure matrix, cancellation propagation across provider/planner/brain/agent, model-free agentic smoke) + `packages/benchmark/tests/dataset-regression-gate.test.ts` (4 tests — BASIC_DATASET bound to `evaluateRegression`). Benchmark now 494 / 28, integration-tests 49, brain 121, CLI 53, errors 23.
- **Gotchas**: FakeProviderConfig `error.code` excludes `CANCELLED` (use real `ModelProviderError`); `AutonomousAgent.status` is a phase snapshot — assert `outcome`+`terminationReason` (`USER_CANCELLED`); brain short-circuits Unknown intents to `classified` (use ExplainCode-style questions for provider tests); package `dist` must be built before dependents typecheck new APIs; new workspace deps need `pnpm install` for the symlink; regression thresholds are strict (`>`), a 1/10 failure needs `minSuccessRate: 0.95`.