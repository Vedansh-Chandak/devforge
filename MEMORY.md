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
### DF-027 — model role wiring (completed 2026-08-19)
Consumers use `ModelRouter` roles (`reasoning`/`coding`/`fast`), never concrete providers. Added `ModelRouterLike`, `resolveConfiguredModelRole`, role-wiring tests for brain/planner/multi-agent, CLI `config` routes rendering + `doctor` model-routes check, model-provider streaming-contract tests, provider-boundary guard (`integration-tests/provider-boundary.test.ts` scanning consumer src trees). No commit.
- Backward compatible: `provider` injection still wins; router-only path honors `role` with reasoning→fast selection fallback (never fake-provider degradation).
- `normalizeComplete` now carries `fakeResponse` so fake role configs build deterministic providers.

### DF-028 — E2E production path proven + hardened (completed 2026-08-19)
3,982 passing tests / 25 packages; root check-types+build+lint 55/55, test 46/46; no commit. Reports: `DF-027-Stop-Condition-Report.md`, `DF-028-Stop-Condition-Report.md` (19 sections).
- **Secret leak found & fixed**: `ParseFailure.rawOutput`/`partialValue` leaked unredacted provider output into CLI JSON via the cause chain. Fixed centrally in `createParseFailure` (`patch-parser.ts`, `reasoning-parser.ts`). Extended `redactSecretText` with `sk-ant-*`, `sk-*`, `AIza*`, `gsk_*`, `xai-*`.
- `AutonomousCodingEngine` is single-use; initial patch failure rejects `run()`; apply/verify/repair failures return reports (`BUDGET_EXCEEDED`). Coding event `sequence` is 0-based; `runId` pattern `coding-...`.
- `RepairDecision` contract: `strategy` ∈ {REWRITE,PATCH,CREATE,DELETE,RESTORE,ABORT}, `scope` ∈ {MINIMAL,BROAD} (required).
- CLI: run/ask `--json` and logger are stdout/stderr separated; doctor --models smoke is opt-in with 30s timeout.
- Test type gotchas: `ArtifactKind` has no `'SRC'` (use `'FILE'`); `RepairStrategy` has no `'MODIFY'`; `pool.register` wants `RoleAgent` wrapping backends via `outputToResult(task, await backend(...), ctx, 1)`; `CommandResult.command` is a typed union — cast for fixtures.
- Out of DF-028 scope (DF-029+): provider failover, new providers, RAG/vector/embeddings, fine-tuning, cloud/dashboard/billing, new UI, VS Code role-model UI, agent-memory redesign, lint coverage expansion.
