# DF-025 — Production Hardening Architecture Audit

Phase 1 of DF-025. Audit of the existing DevForge architecture across package
boundaries, before any hardening changes. Scope: all `packages/*`,
`apps/cli`, `extensions/vscode`.

Severity scale: `critical` / `high` / `medium` / `low`.

---

## 1. Cancellation is checked at boundaries but never propagates into an in-flight model call

- **Package:** `@devforge/model-provider`, `@devforge/brain`, `@devforge/execution`, `@devforge/planner`
- **Severity:** high
- **Existing behavior:** `ModelProvider.generate(request)` has no `AbortSignal`
  parameter (`packages/model-provider/src/types.ts:41-44`). Every consumer that
  wants cancellation — the Brain `ReasoningLoop`
  (`packages/brain/src/reasoning/loop.ts:93`), the execution
  `ProviderCodingModel`/`ProviderReasoningModel`
  (`packages/execution/src/models/provider-models.ts:57-59`), and the Executor —
  checks `signal.aborted` *before* calling the provider, but the in-flight HTTP
  call runs to completion (`packages/model-provider/src/openai-compatible.ts:212`).
  The OpenAI provider's timeout is an internal `AbortController` that cannot be
  linked to an external signal. `FakeModelProvider.delay` is an uncancellable
  `setTimeout` (`packages/model-provider/src/testing/fake-provider.ts:30-32`).
  External cancellation only takes effect between round/step boundaries.
- **Risk:** A cancelled or timed-out task keeps a model call running and
  burning request budget; in CI or long-running agents this delays shutdown and
  leaks in-flight work.
- **Minimal fix:** Add `signal?: AbortSignal` to `ModelRequest`, have the OpenAI
  provider combine the external signal with its internal timeout controller,
  make `FakeModelProvider` honour the signal (abort the delay), and pass the
  consumer's signal through `request.signal` from Brain loop, planner, and the
  execution models.
- **Test required:** cancellation during model generation (OpenAI + fake),
  timeout during model generation, already-aborted signal short-circuits before
  the fetch.

## 2. The Planner has no cancellation or timeout support

- **Package:** `@devforge/planner`
- **Severity:** high
- **Existing behavior:** `Planner.plan()` accepts only a string; grep for
  `AbortSignal|abort|cancel|signal|timeout` in `packages/planner/src` returns
  nothing. A model-backed plan call cannot be cancelled or timed out at the
  planner layer.
- **Risk:** Planning is the first stage of every pipeline; a hung model call
  there blocks the whole run with no escape hatch.
- **Minimal fix:** Accept an optional `signal?: AbortSignal` on
  `Planner.plan()`, pass it into the request, and surface cancellation as a
  distinct result (`ok:false`, error `code: 'MODEL_CANCELLED'`).
- **Test required:** cancellation during planning (deterministic),
  already-aborted signal returns a cancelled result without calling the model.

## 3. `ModelProviderError` has no `CANCELLED` code, so cancellation and timeout conflate

- **Package:** `@devforge/model-provider`
- **Severity:** medium
- **Existing behavior:** `ModelErrorCode` is `AUTHENTICATION_ERROR |
  RATE_LIMITED | TIMEOUT | NETWORK_ERROR | INVALID_REQUEST | MODEL_NOT_FOUND |
  PROVIDER_ERROR | UNKNOWN` (`packages/model-provider/src/errors.ts:5-13`).
  Abort of an external signal would surface as a network-ish error. Timeouts and
  external cancellation are indistinguishable at the provider contract level.
- **Risk:** Error mapping and retry decisions cannot distinguish "cancel me"
  from "slow"; retry loops can incorrectly retry cancellations.
- **Minimal fix:** Add `CANCELLED` to `ModelErrorCode`; map an aborted external
  signal to `{ code: 'CANCELLED', retryable: false }`.
- **Test required:** aborted signal produces `CANCELLED`, timeout produces
  `TIMEOUT`, both reported with `retryable: false`.

## 4. Error signaling mixes thrown errors, ok-unions, and status-unions across packages

- **Package:** `@devforge/brain`, `@devforge/planner`, `@devforge/execution`,
  `@devforge/autonomous`, `@devforge/multi-agent`
- **Severity:** medium
- **Existing behavior:** Planner returns `PlanResult` (`{ok:true,plan} |
  {ok:false,error}`) and also throws `PlanningError`. Brain returns a status
  union `AskResult` (`answered | classified | invalid | provider_error |
  tool_executed`). Executor throws typed `ExecutorError` subclasses. Autonomous
  returns `AgentOutcome` enums and throws `AutonomousError`. Multi-agent mixes
  `TaskResult` ok-booleans with status unions. There is no shared envelope; the
  CLI maps each with a separate switch (`apps/cli/src/commands/*`).
- **Risk:** Cross-package handling requires bespoke mapping per boundary; new
  subsystems must re-learn the convention; diagnostics lose `cause`,
  `component`, `retryable`, and `operation` context.
- **Minimal fix:** Introduce a shared, additive `ErrorEnvelope` in a new
  dependency-free `@devforge/errors` package with deterministic codes,
  category classification (user vs system, cancellation vs failure, timeout vs
  generic), optional cause/operation/component/timestamp/metadata. Do **not**
  replace existing package error classes — only provide mapping to the envelope
  where results cross package boundaries (primarily CLI output and reports).
- **Test required:** envelope round-trips for each existing error class
  (`ModelProviderError`, `ToolError`, `CommandError`, `ExecutorError`,
  `AutonomousError`, `MultiAgentError`, `MemoryError`), retains cause, redacts
  messages, marks cancellation/timeout/retryable correctly.

## 5. The logger does not redact or sanitize log output

- **Package:** `@devforge/logger`
- **Severity:** high
- **Existing behavior:** The shared pino logger is created with no `redact`
  option (`packages/logger/src/logger.ts`). Consumers log raw error strings,
  e.g. `runtime.ts:74` logs `Failed to parse ${file}: ${error}` and
  `runtime.ts:180` logs stage failure messages — verbatim content that may
  embed tokens, paths, or environment data. `@devforge/memory` ships a robust
  `redactSecrets` (high-entropy heuristic, PEM blocks, Bearer, KEY=value, URL
  userinfo) but the logger does not use it.
- **Risk:** Secrets can reach logs, which are often shipped to observability
  backends and bug reports.
- **Minimal fix:** Configure pino `redact` for known paths and route messages
  through a deterministic `redactSecrets`-style hook, or expose a redacting
  `logMethod` hook.
- **Test required:** a log line containing an API key, Bearer token, PEM block,
  and `KEY=value` password never appears in the emitted output.

## 6. Memory auto-save failure breaks the save chain silently

- **Package:** `@devforge/memory`
- **Severity:** high
- **Existing behavior:** `onMutation` fires `void this.markDirty(op)`
  (`packages/memory/src/repository-memory.ts:116-120`). `markDirty` chains onto
  `saveTail`; if `persistence.save()` rejects, the rejection is unhandled (the
  `void` discards the promise) and `saveTail` stays permanently rejected — all
  future auto-saves are skipped and every subsequent mutation produces another
  unhandled rejection. Only `flush()` surfaces it.
- **Risk:** After one transient I/O error, memory silently stops persisting
  without any user-visible signal, and Node emits `unhandledRejection` warnings.
- **Minimal fix:** Track the tail with a catch so the chain recovers, and
  surface the first failure (e.g. via `flush()` rejection) while allowing later
  saves to proceed.
- **Test required:** a save that rejects midway does not break subsequent
  auto-saves; `flush()` surfaces the error; no unhandled rejection is emitted.

## 7. `@devforge/tools` declares `signal` but no tool honours it; `ToolErrorCode.TIMEOUT` is never produced

- **Package:** `@devforge/tools`
- **Severity:** medium
- **Existing behavior:** `ToolExecutionContext` carries `signal?: AbortSignal`
  (`packages/tools/src/types.ts:78`) but `executeTool`, `executeModelToolCalls`,
  `FakeTool`, and repository tools ignore it; `readFile` uses synchronous
  `fs.readFileSync`. `ToolErrorCode.TIMEOUT` exists (`types.ts:102`) but no
  code path produces it; `FakeTool.delayMs` is an uncancellable `setTimeout`.
- **Risk:** A hanging tool blocks the controlled executor; the declared
  cancellation contract is not honoured, giving false confidence.
- **Minimal fix:** Check `context.signal?.aborted` at the top of the controlled
  executor and in `FakeTool`; report `CANCELLED`. Do not convert sync reads to
  async in this phase (out of scope for correctness hardening).
- **Test required:** an aborted context short-circuits tool execution with a
  `CANCELLED` result; a delay-based fake tool with a cancelled signal does not
  wait.

## 8. Repository tool calls do not honour timeout or cancellation

- **Package:** `@devforge/tools`
- **Severity:** low (covered by #7)

## 9. `@devforge/runtime` swallows per-file parse failures and cannot be cancelled

- **Package:** `@devforge/runtime`
- **Severity:** medium
- **Existing behavior:** `parseTypeScript` failures are logged at `warn` and
  dropped entirely — the file is absent from `parsedFiles` and **not** added to
  `context.errors`, so a repo with one unparseable file still yields
  `success: true` (`packages/runtime/src/runtime.ts:69-76`). `execute()` has no
  `AbortSignal` and no timeout; `dispose()` only flips the initialized flag.
- **Risk:** Analysis results can be silently incomplete while appearing
  successful.
- **Minimal fix:** Record parse failures as stage errors (keep `success`
  semantics but expose the error list), and accept an optional signal so a hung
  indexer/parser can be stopped. This is additive; do not change `success`
  semantics for consumers in this phase.
- **Test required:** a fixture with a syntax-error file reports it in
  `context.errors`; an aborted execution stops early.

## 10. CLI exit codes 2-8 are defined but the top-level path always returns 1

- **Package:** `@devforge/cli` (in `apps/cli`)
- **Severity:** medium
- **Existing behavior:** `CliError` subclasses carry `exitCode`
  (`apps/cli/src/errors.ts`), but `orchestrator.ts:202-203` and `main.ts:16`
  always return/exit 1 for non-commander errors, so `ConfigError`→2,
  `DiscoveryError`→3, etc. never propagate.
- **Risk:** Scripts cannot distinguish config errors from execution errors.
- **Minimal fix:** In `run()`, return the typed error's `exitCode` when the
  error is a `CliError`.
- **Test required:** a thrown `ConfigError` yields exit code 2; a generic error
  yields 1.

## 11. IPC via a global side-channel (`globalThis.__devforgeOptions`)

- **Package:** `@devforge/cli`
- **Severity:** low
- **Existing behavior:** CLI options are stuffed into
  `globalThis.__devforgeOptions` by a `preAction` hook
  (`apps/cli/src/services/orchestrator.ts:30-34`) and read back by
  `getCliOptions`. Works, but is process-global, test-fragile, and bypasses
  types. No behavioural risk given single-run CLI semantics.
- **Minimal fix:** Document as known limitation; do not redesign in DF-025.

## 12. `commands/fix.ts --debug` returns early without running the fix

- **Package:** `@devforge/cli`
- **Severity:** medium
- **Existing behavior:** `handleFix` returns a placeholder string when
  `options.debug` is set (`apps/cli/src/commands/fix.ts:18-20`), so `--debug`
  silently does nothing.
- **Risk:** Debug mode hides real behaviour; CI scripts that use `--debug` get
  no work done.
- **Minimal fix:** Remove the early return; keep debug as a rendering toggle.
- **Test required:** a `--debug` fix invocation actually runs the coding engine.

## 13. `commands/review.ts` assigns a `reasoningModel` it never uses, and discards the `DEVFORGE_REASONING` JSON

- **Package:** `@devforge/cli`
- **Severity:** low (dead code, no behavioural regression)
- **Existing behavior:** The structured review always comes from the regex
  heuristic `generateStructuredReview`; the model's JSON output is never parsed.
- **Minimal fix:** Document; optionally wire the parsed model output in a later
  phase. Not a correctness regression.

## 14. `commands/explain.ts` creates a second redundant Runtime and discards the first

- **Package:** `@devforge/cli`
- **Severity:** low (resource efficiency)
- **Existing behavior:** `handleExplain` builds its own `DevForgeRuntime` while
  the brain service already owns one, then disposes the private copy after
  `brain.ask`. No leak beyond wasted indexing work.

## 15. `commands/doctor.ts` duplicates `runCheck` + `HealthCheck` already in `services/environment.ts`

- **Package:** `@devforge/cli`
- **Severity:** low
- **Minimal fix:** leave as-is; note duplication for future consolidation.

## 16. `packages/validation` has a broken `validate` npm script

- **Package:** `@devforge/validation`
- **Severity:** medium
- **Existing behavior:** `package.json` runs
  `node --loader ts-node/esm src/cli.ts`, but `src/cli.ts` does not exist and
  `ts-node` is not a dependency. The script always fails.
- **Risk:** `pnpm test`/validation workflows for the validation package are
  broken out of the box.
- **Minimal fix:** Point the script at the existing entry point
  (`src/smoke-test.ts`) or remove the broken script.
- **Test required:** the package's `test` script passes.

## 17. Provider interface is duplicated between `@devforge/model-provider` and `@devforge/brain`

- **Package:** `@devforge/brain`, `@devforge/core`
- **Severity:** low
- **Existing behavior:** Brain defines a structurally identical
  `ModelProviderInterface` (`packages/brain/src/types.ts:23-30`) and `core`'s
  provider factory binds to the brain copy
  (`packages/core/src/provider-factory.ts:9`) instead of the canonical
  `ModelProvider` from `@devforge/model-provider`.
- **Risk:** Drift risk; the two types could diverge.
- **Minimal fix:** Re-export/alias the canonical type. Additive and safe once
  the model-provider gains `signal` (fields go through `ModelRequest`).

## 18. Declared-but-unused workspace dependencies

- **Package:** `@devforge/core` (`@devforge/config`, `@devforge/logger`),
  `@devforge/tools` (`@devforge/runtime` devDep)
- **Severity:** low
- **Minimal fix:** remove from `package.json`.
- **Test required:** none (dependency metadata change), but `pnpm check-types`
  must still pass.

## 19. `RuntimeConfig.config.*` options are never forwarded to the underlying packages

- **Package:** `@devforge/runtime`
- **Severity:** low
- **Existing behavior:** `RuntimeConfig.config` (repositoryIndexer/
  symbolGraph/knowledgeGraph) is parsed but never passed through
  (`packages/runtime/src/runtime.ts:47`).
- **Minimal fix:** Document as known limitation for DF-025.

## 20. `packages/config` throws at import time and freezes env for process lifetime

- **Package:** `@devforge/config`
- **Severity:** low
- **Existing behavior:** `envSchema.parse(process.env)` runs eagerly
  (`packages/config/src/env.ts:9`); a bad `NODE_ENV` crashes any importing
  module with an untyped zod error.
- **Minimal fix:** Nothing required in DF-025; add safe parsing helper in the
  DF-025 config layer instead.
- **Test required:** shared runtime config resolution must not throw on missing
  env; precedence explicit>file>env>default is verified.

## 21. Workspace/CommandRunner/GitService already have strong containment

- **Package:** `@devforge/execution`
- **Severity:** (finding — clean)
- **Existing behavior:** `spawn(...)` with `shell:false` only
  (`runner.ts:151`), command allowlist (`validator.ts`), cwd + symlink realpath
  containment (`sandbox.ts`, `runner.ts:49`), env allowlist
  (`environment.ts ALLOWLIST_ENV_VARS`), output byte budgets, per-request
  `timeoutMs` + `abortSignal` with SIGKILL + listener cleanup, explicit
  `timedOut`/`cancelled` flags. GitService path validation in place.
- **Minimal fix:** none required. Preserve.

## 22. Executor already emits a deterministic timestamped event stream

- **Package:** `@devforge/execution`
- **Severity:** (finding — meets Phase 8 baseline)
- **Existing behavior:** `ExecutionEvent` with sequence, timestamp, planId,
  EXECUTION_STARTED / PLAN_VALIDATED / STEP_STARTED / VERIFICATION_* /
  EXECUTION_COMPLETED / EXECUTION_FAILED / EXECUTION_CANCELLED
  (`packages/execution/src/executor/executor.ts:244-256`). Brain emits
  `AgentEvent`/loop events; autonomous emits `AgentEvent` with sequence.
- **Minimal fix:** covers task/planning/tool/verification/repair/cancellation/
  timeout at the executor layer. Add a thin shared `LifecycleEvent` mapper only
  where CLI output needs component+operation metadata.

## 23. No top-level SIGINT handling in the CLI

- **Package:** `@devforge/cli`
- **Severity:** medium
- **Existing behavior:** `run()` awaits `program.parseAsync` and sets exit code;
  there is no `AbortController` wired to SIGINT, so Ctrl-C during a long run
  relies on the OS signal default (which terminates the process) rather than a
  graceful cancellation path.
- **Minimal fix:** install a SIGINT handler that aborts a controller threaded
  into session services → planner/brain/executor/coding engine.
- **Test required:** CLI-level cancellation during execution surfaces
  `CANCELLED` outcomes and non-zero exit.

## 24. Benchmark is clean and deterministic (DF-024)

- **Package:** `@devforge/benchmark`
- **Severity:** (finding — clean)
- **Existing behavior:** Injected Clock/Environment/FileSystemIO/CommandRunner,
  seeded PRNG, content-hash result IDs, immutable stores, `redactSecrets`
  redaction on artifacts, `BASIC_DATASET` (10 tasks), run/comparison/
  regression reports.
- **Minimal fix:** none required; use as Phase 11 harness.

## 25. VS Code extension delegates to `@devforge/cli` through a `CliAdapter`

- **Package:** `extensions/vscode`
- **Severity:** (finding — clean boundary)
- **Existing behavior:** `DevForgeClient` delegates entirely to the CLI public
  API; no re-implemented engine logic. Note: the LSP `SymbolExtractor` is a
  regex-based re-implementation of `@devforge/parser-typescript` symbol
  extraction — a documented duplication, not a boundary violation.

## 26. `@devforge/github` reuses `AutonomousAgent` rather than duplicating it

- **Package:** `@devforge/github`
- **Severity:** (finding — clean boundary)
- **Existing behavior:** `fixCi` repair loop drives `@devforge/autonomous`'s
  `AutonomousAgent` and `context-engine`; no duplicated engine logic.

## 27. Workspace transaction / snapshot cleanup has no explicit cancellation path

- **Package:** `@devforge/autonomous` (RollbackManager), `@devforge/execution`
- **Severity:** low
- **Existing behavior:** `RollbackManager` snapshots and restores via Workspace
  transactions; terminal paths restore on failure, cancellation restores
  implicitly through the agent loop. No long-lived handles. Resource cleanup on
  success/failure/timeout/cancellation is exercised by the agent's `finalize`.
- **Minimal fix:** none required beyond tests proving restore happens on
  cancellation and timeout.

## 28. `apps/api`, `apps/web`, `packages/ui` are scaffold placeholders

- **Package:** `apps/api`, `apps/web`, `packages/ui`
- **Severity:** low (out of DF-025 scope)
- **Existing behavior:** Fastify skeleton with an unregistered request-context
  plugin; untouched create-turbo landing page.
- **Minimal fix:** out of scope; document.

## 29. `README.md` and `docs/` are stale relative to the 25+ package workspace

- **Package:** repo root
- **Severity:** low

## 30. `FakeTool.failWith` builds errors via `as any` (missing `name`/`cause`)

- **Package:** `@devforge/tools`
- **Severity:** low
- **Minimal fix:** construct a proper `ToolError`.
- **Test required:** `failWith` produces an error whose `name === 'ToolError'`.

---

## Prioritized remediation list (this phase)

1. **P2** — shared `@devforge/errors` envelope + lifecycle event model (new
   dependency-free package).
2. **P4/P7** — `signal?: AbortSignal` on `ModelRequest`; `CANCELLED` code;
   OpenAI + Fake honour external signal; planner accepts signal.
3. **P6** — logger redaction; CLI error/output redaction; regression tests for
   secret-shaped values.
4. **P5** — memory auto-save chain fix; `RepositoryMemory.dispose()`.
5. **P4** — wire SIGINT → AbortController through CLI services.
6. **P9/P10/P11** — deterministic integration suite (temp git repos, fake
   providers): 15 scenarios + failure matrix + BASIC_DATASET regression.
   **DONE** — `packages/integration-tests/src/hardening.test.ts` (17 tests:
   envelope failure matrix, cancellation propagation through provider/planner/
   brain/agent, deterministic agentic smoke) + `packages/benchmark/tests/
   dataset-regression-gate.test.ts` (BASIC_DATASET regression gate). Also fixed
   a real P9 gap found by the suite: the ReasoningLoop swallowed an aborted
   signal into a misleading `tool_executed` result; it now surfaces a
   `provider_error` with `code: CANCELLED` and `retryable: false`.
7. **P12** — fix only real boundary issues (validation script,
   dead deps, `fix --debug` early return, CLI exit-code propagation).