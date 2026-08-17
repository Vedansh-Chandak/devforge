# DF-025 Stop-Condition Report

Status of the DF-025 remediation against the prioritized list in
[DF-025-AUDIT.md](DF-025-AUDIT.md). Each phase below is verified by its
package test suite and the root `pnpm check-types` (26/26 green).

| # | Item | Status | Where verified |
|---|------|--------|----------------|
| P2 | `@devforge/errors` envelope + lifecycle event model | DONE | `packages/errors` — 23 tests |
| P4/P7 | `signal?: AbortSignal` on `ModelRequest`; `CANCELLED` code; OpenAI + Fake honour external signal; planner accepts signal | DONE | `packages/model-provider` — 76 tests; `packages/planner` — 51 tests |
| P4 | SIGINT → AbortController wired through CLI services | DONE | `apps/cli` — 53 tests |
| P5 | memory auto-save chain fix; `RepositoryMemory.dispose()` | DONE | `packages/memory` — 277 tests |
| P6 | logger redaction; CLI error/output redaction; secret regression tests | DONE | `packages/logger` — 2 tests; `apps/cli` |
| P9/P10/P11 | deterministic integration suite: 15 scenarios + failure matrix + BASIC_DATASET regression | DONE | `packages/integration-tests` — 49 tests (17 hardening); `packages/benchmark` — 494 tests (4 regression-gate) |
| P12 | validation script, dead deps, `fix --debug` early return, CLI exit-code propagation | DONE | `packages/validation` — 18 tests; core/tools deps; `apps/cli` |

## Real defects surfaced by the hardening suite

1. **ReasoningLoop swallowed cancellation** (`packages/brain/src/reasoning/loop.ts`).
   An aborted signal made the outer guard stop the loop, but the loop reported
   a generic `tool_executed` result with zero tool calls — the caller could not
   distinguish "user cancelled" from "ran to a bound". The loop now returns a
   `provider_error` result with `code: CANCELLED`, `retryable: false`, and
   `terminationReason: 'CANCELLED'`. Brain maps it to
   `BrainProviderError.errorCode: 'CANCELLED'`.
2. **Class-name-only cancellation/timeout errors escaped the envelope**
   (`packages/errors/src/envelope.ts`). Legacy/codeless subclasses like
   `AutonomousCancellationError` / `AutonomousTimeoutError` were classified as
   generic `SYSTEM` errors. `isCancellationError` / `isTimeoutError` now also
   inspect the constructor class name (consistent with `detectComponent`), so
   those errors envelope as `CANCELLATION` / `TIMEOUT` and non-retryable.
3. **`FakeTool.failWith` built errors via `as any`** (`packages/tools/src/fake-tool.ts`,
   audit #30). The plain object was not `instanceof Error`, so error-handling
   layers in `model-executor.ts` fell back to the generic `'Tool execution
   failed'` message and lost the tool's real code/message. `failWith` now
   constructs a proper `ToolError`, and the real message surfaces end-to-end.
   Added the audit's test requirement (`name === 'ToolError'`).

## Deferred non-goals (unchanged from audit)

- Finding #11 `globalThis.__devforgeOptions` IPC — documented limitation.
- Finding #19 `RuntimeConfig.config.*` not forwarded — document only.
- Finding #20 `config/env.ts` eager parse at import — safe parsing helper added
  in the new runtime-config layer instead.
- Finding #13 `review.ts` reasoningModel dead code — document only.
- Finding #15 `doctor.ts` duplication — left as-is.
- Finding #25 VS Code delegation boundary — verified clean.
- Finding #27 RollbackManager cancellation — documented.

## Final verification (2026-08-17)

- `pnpm --filter @devforge/errors build && test` — 23 pass
- `pnpm --filter @devforge/brain build && test` — 121 pass
- `pnpm --filter @devforge/integration-tests check-types && test` — 49 pass
- `pnpm --filter @devforge/benchmark test` — 494 pass
- `pnpm --filter @devforge/cli test` — 53 pass
- `pnpm --filter @devforge/tools test` — 155 pass
- Root `pnpm check-types` — 26/26 successful
- Root `pnpm build` — 26/26 successful
- Root `pnpm test` — 46/46 tasks successful
